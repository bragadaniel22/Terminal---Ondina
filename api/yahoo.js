const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Cookie+crumb do Yahoo reaproveitados entre chamadas enquanto a lambda estiver quente (e entre
// os tickers de um mesmo lote) — cada par novo custa 2 requisições extras, e o crumb vale por
// bastante tempo. Sem isso, um lote de 26 tickers com 3 commodities pagaria 6 requisições de
// autenticação em vez de 2.
let cachedAuth = null;
const AUTH_TTL_MS = 10 * 60 * 1000;

async function getYahooAuth() {
  if (cachedAuth && Date.now() - cachedAuth.ts < AUTH_TTL_MS) return cachedAuth;

  const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA, 'Accept': '*/*' } });
  let cookie = '';
  if (typeof cookieRes.headers.getSetCookie === 'function') {
    cookie = cookieRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  } else {
    cookie = (cookieRes.headers.get('set-cookie') || '').split(';')[0];
  }

  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie },
  });
  const crumb = await crumbRes.text();
  if (!crumb || crumb.includes('<') || crumb.length > 20) throw new Error('crumb inválido');

  cachedAuth = { cookie, crumb, ts: Date.now() };
  return cachedAuth;
}

// Busca o fechamento anterior oficial via quoteSummary (crumb auth, mesma técnica de
// api/target.js) — usado só como fallback quando o chart endpoint não traz
// regularMarketPreviousClose/previousClose no meta (caso comum em futuros de commodities
// tipo GC=F/CL=F/BZ=F, que operam quase 24h: o bucket diário do chart não bate com o
// fechamento oficial da bolsa, e um heurística sobre os closes do gráfico dava número
// errado — ex: ouro mostrando +1,3% no terminal quando na realidade estava -0,06%).
async function fetchOfficialPreviousClose(ticker) {
  const { cookie, crumb } = await getYahooAuth();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const d = await r.json();
  const prev = d?.quoteSummary?.result?.[0]?.price?.regularMarketPreviousClose?.raw;
  if (prev == null) throw new Error('sem regularMarketPreviousClose');
  return prev;
}

async function fetchChart(ticker, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const data = await r.json();

  const meta = data?.chart?.result?.[0]?.meta;
  if (meta && meta.regularMarketPreviousClose == null && meta.previousClose == null) {
    try {
      meta.regularMarketPreviousClose = await fetchOfficialPreviousClose(ticker);
    } catch {
      // Sem sorte no fallback — o front-end ainda tem o heurística sobre o gráfico.
    }
  }

  return { status: r.status, data };
}

// `t` aceita UM ticker (resposta = JSON cru do Yahoo, formato original) ou VÁRIOS separados por
// vírgula (resposta = { batch: { ticker: <JSON cru do Yahoo> } }). O modo lote existe pra cortar
// custo no Vercel: o ciclo de 60s do terminal pede ~26 tickers, e cada invocação de função
// separada paga o próprio overhead de CPU. Em lote é 1 invocação só, com as buscas ao Yahoo
// rodando em paralelo dentro dela.
export default async function handler(req, res) {
  const { t, range = '5d', interval = '1d' } = req.query;
  if (!t) return res.status(400).json({ error: 'ticker obrigatório' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  // Cache na CDN do Vercel: requisições iguais dentro da janela são servidas sem invocar a
  // função (não gasta CPU). 30s fica abaixo do ciclo de 60s do terminal, então não atrasa o
  // dado de quem está olhando — só economiza quando há mais de uma pessoa/aba usando ao mesmo
  // tempo, ou quando um gráfico é reaberto logo em seguida.
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=90');

  const tickers = String(t).split(',').map((s) => s.trim()).filter(Boolean);

  try {
    if (tickers.length === 1) {
      const { status, data } = await fetchChart(tickers[0], range, interval);
      return res.status(status).json(data);
    }

    // Concorrência limitada: 26 requisições simultâneas ao Yahoo saindo do mesmo IP tendem a
    // levar 429. Em ondas de 8 o lote inteiro sai em ~1-2s e o Yahoo não reclama.
    const MAX_CONCURRENT = 8;
    const batch = {};
    for (let i = 0; i < tickers.length; i += MAX_CONCURRENT) {
      const wave = tickers.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.allSettled(wave.map((tk) => fetchChart(tk, range, interval)));
      results.forEach((r, j) => {
        batch[wave[j]] = r.status === 'fulfilled'
          ? r.value.data
          : { error: r.reason?.message || 'erro' };
      });
    }
    return res.status(200).json({ batch });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
