// Ficha da empresa: tudo que o Yahoo sabe sobre um ticker, numa chamada só.
//
// GET /api/company?t=NVDA
//
// O quoteSummary aceita vários módulos de uma vez (testado: 14 módulos em ~580ms), então a
// página inteira sai de UMA requisição. A resposta crua passa de 190 KB; aqui ela é reduzida
// só ao que a tela mostra, porque mandar o resto pro navegador seria desperdício de banda.
//
// Precisa de cookie+crumb, mesma autenticação de api/target.js e do fallback de fechamento
// anterior em api/yahoo.js.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const MODULOS = [
  'price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile',
  'earningsHistory', 'calendarEvents', 'recommendationTrend', 'majorHoldersBreakdown',
  'institutionOwnership',
].join(',');

// O quoteSummary devolve cada número como { raw, fmt, longFmt }. Em quase todo lugar queremos
// o `raw` (pra formatar no padrão brasileiro no front) — `fmt` só serve pros casos em que o
// Yahoo já abrevia melhor do que nós (ex: "3.59T" de market cap).
const raw = (x) => (x && typeof x === 'object' && 'raw' in x ? x.raw : (typeof x === 'number' ? x : null));
const fmt = (x) => (x && typeof x === 'object' && 'fmt' in x ? x.fmt : null);

let authCache = null;
const AUTH_TTL_MS = 10 * 60 * 1000;

async function getAuth() {
  if (authCache && Date.now() - authCache.ts < AUTH_TTL_MS) return authCache;
  const ck = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA, Accept: '*/*' } });
  const cookie = typeof ck.headers.getSetCookie === 'function'
    ? ck.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    : (ck.headers.get('set-cookie') || '').split(';')[0];
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
  });
  const crumb = await crumbRes.text();
  if (!crumb || crumb.includes('<') || crumb.length > 20) throw new Error('crumb inválido');
  authCache = { cookie, crumb, ts: Date.now() };
  return authCache;
}

export default async function handler(req, res) {
  const { t } = req.query;
  if (!t) return res.status(400).json({ error: 'ticker obrigatório' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  // Fundamentos mudam em trimestres, não em segundos. 15 min de CDN deixa a navegação entre
  // empresas instantânea sem servir nada defasado de verdade.
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');

  try {
    const { cookie, crumb } = await getAuth();
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(t)}`
      + `?modules=${MODULOS}&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Yahoo ${r.status}`);
    const d = await r.json();
    const q = d?.quoteSummary?.result?.[0];
    if (!q) throw new Error('ticker sem dados');

    const p = q.price || {}, s = q.summaryDetail || {}, k = q.defaultKeyStatistics || {};
    const f = q.financialData || {}, perfil = q.assetProfile || {};

    // Recomendação do período mais recente (o Yahoo devolve uma série de meses).
    const rec = (q.recommendationTrend?.trend || [])[0] || null;

    const resultados = (q.earningsHistory?.history || []).map((h) => ({
      trimestre: fmt(h.quarter),
      epsEstimado: raw(h.epsEstimate),
      epsReal: raw(h.epsActual),
      surpresaPct: raw(h.surprisePercent) != null ? raw(h.surprisePercent) * 100 : null,
    })).filter((h) => h.epsReal != null);

    const instituicoes = (q.institutionOwnership?.ownershipList || []).slice(0, 8).map((o) => ({
      nome: o.organization,
      pct: raw(o.pctHeld) != null ? raw(o.pctHeld) * 100 : null,
      valor: fmt(o.value),
    }));

    return res.json({
      ticker: p.symbol || t,
      nome: p.longName || p.shortName || t,
      bolsa: p.exchangeName || p.exchange || null,
      moeda: p.currency || null,
      tipo: p.quoteType || null,

      preco: {
        atual: raw(p.regularMarketPrice),
        variacao: raw(p.regularMarketChange),
        variacaoPct: raw(p.regularMarketChangePercent) != null ? raw(p.regularMarketChangePercent) * 100 : null,
        fechamentoAnterior: raw(p.regularMarketPreviousClose),
        abertura: raw(p.regularMarketOpen),
        maxDia: raw(p.regularMarketDayHigh),
        minDia: raw(p.regularMarketDayLow),
        volume: raw(p.regularMarketVolume),
      },

      metricas: {
        marketCap: fmt(p.marketCap),
        peTrailing: raw(s.trailingPE),
        peForward: raw(s.forwardPE),
        eps: raw(k.trailingEps),
        dividendYield: fmt(s.dividendYield),
        beta: raw(s.beta),
        min52: raw(s.fiftyTwoWeekLow),
        max52: raw(s.fiftyTwoWeekHigh),
        volumeMedio: raw(s.averageVolume),
        margemLucro: raw(f.profitMargins) != null ? raw(f.profitMargins) * 100 : null,
        crescReceita: raw(f.revenueGrowth) != null ? raw(f.revenueGrowth) * 100 : null,
        receita: fmt(f.totalRevenue),
        caixa: fmt(f.totalCash),
        divida: fmt(f.totalDebt),
      },

      analistas: {
        alvoMedio: raw(f.targetMeanPrice),
        alvoMin: raw(f.targetLowPrice),
        alvoMax: raw(f.targetHighPrice),
        quantidade: raw(f.numberOfAnalystOpinions),
        recomendacao: f.recommendationKey || null,
        distribuicao: rec ? {
          compraForte: rec.strongBuy, compra: rec.buy, manter: rec.hold,
          venda: rec.sell, vendaForte: rec.strongSell,
        } : null,
      },

      perfil: {
        setor: perfil.sector || null,
        industria: perfil.industry || null,
        funcionarios: perfil.fullTimeEmployees || null,
        site: perfil.website || null,
        pais: perfil.country || null,
        resumo: perfil.longBusinessSummary || null,
      },

      resultados: {
        proximaData: q.calendarEvents?.earnings?.earningsDate?.[0]?.fmt || null,
        historico: resultados,
      },

      detentores: {
        insidersPct: raw(q.majorHoldersBreakdown?.insidersPercentHeld) != null
          ? raw(q.majorHoldersBreakdown.insidersPercentHeld) * 100 : null,
        instituicoesPct: raw(q.majorHoldersBreakdown?.institutionsPercentHeld) != null
          ? raw(q.majorHoldersBreakdown.institutionsPercentHeld) * 100 : null,
        principais: instituicoes,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
