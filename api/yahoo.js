const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Busca o fechamento anterior oficial via quoteSummary (crumb auth, mesma técnica de
// api/target.js) — usado só como fallback quando o chart endpoint não traz
// regularMarketPreviousClose/previousClose no meta (caso comum em futuros de commodities
// tipo GC=F/CL=F/BZ=F, que operam quase 24h: o bucket diário do chart não bate com o
// fechamento oficial da bolsa, e um heurística sobre os closes do gráfico dava número
// errado — ex: ouro mostrando +1,3% no terminal quando na realidade estava -0,06%).
async function fetchOfficialPreviousClose(ticker) {
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

  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const d = await r.json();
  const prev = d?.quoteSummary?.result?.[0]?.price?.regularMarketPreviousClose?.raw;
  if (prev == null) throw new Error('sem regularMarketPreviousClose');
  return prev;
}

export default async function handler(req, res) {
  const { t, range = '5d', interval = '1d' } = req.query;
  if (!t) return res.status(400).json({ error: 'ticker obrigatório' });

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=${range}&interval=${interval}&includePrePost=false`;

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const data = await r.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    const meta = data?.chart?.result?.[0]?.meta;
    if (meta && meta.regularMarketPreviousClose == null && meta.previousClose == null) {
      try {
        meta.regularMarketPreviousClose = await fetchOfficialPreviousClose(t);
      } catch {
        // Sem sorte no fallback — o front-end ainda tem o heurística sobre o gráfico.
      }
    }

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
