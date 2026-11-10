// Yields de treasury americano. Arquivo próprio, separado de api/b3.js (que é só DI
// Futuro/B3 brasileira) — não faz sentido um yield americano viver dentro de um arquivo
// chamado "b3", mesmo que a fonte de histórico (TradingView) seja compartilhada.
//
// Motivo de existir: o Yahoo Finance não tem um ticker líquido pro yield de 2 anos (só um
// contrato futuro com volume irrelevante, confirmado ao vivo) — o de 10 anos (^TNX) já tem
// histórico bom no Yahoo Finance e continua vindo de lá (ver index.html — card "Juros
// Globais" e CLOSE_REPORT_CONFIG).
//
// Cotação: CNBC primeiro (endpoint REST simples, sem scanner/protocolo nenhum, e já devolve
// o fechamento anterior pronto no campo `previous_day_closing` — mais simples e mais direto
// que o scanner do TradingView), com fallback pro TradingView se a CNBC cair (mesmo padrão
// B3-depois-TradingView já usado pro DI Futuro em api/b3.js). A CNBC bloqueia com 403
// (Akamai) requisições sem User-Agent de navegador — confirmado ao vivo — mas não é bloqueio
// de IP de datacenter (diferente do ADVFN, que chegou a ser tentado e descartado no passado
// por bloquear até com User-Agent certo).
//
// Histórico: só TradingView (protocolo WebSocket em lib/tradingview-history.js) — a CNBC tem
// um endpoint GraphQL de gráfico (`webql-redesign.cnbcfm.com/graphql`), mas exige uma query
// persistida (hash) que muda a cada deploy do site deles e não foi possível capturar ao vivo
// (o navegador automatizado tomou bloqueio Akamai ao carregar a página cnbc.com/quotes/...,
// mesmo quando o endpoint de cotação simples funcionava). Não vale a pena adivinhar o schema
// GraphQL às cegas.
//
// GET /api/treasury?symbol=TVC:US02Y              → cotação atual
// GET /api/treasury?symbol=TVC:US02Y&history=1    → histórico diário (~2 anos)
import { fetchTradingViewHistory } from '../lib/tradingview-history.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Símbolo do TradingView -> símbolo da CNBC. A CNBC não usa zero à esquerda pro yield de 2
// anos ("US2Y", não "US02Y" como o TradingView) — mapa curado manualmente em vez de regra
// automática, só precisa cobrir o que este arquivo realmente atende hoje.
const CNBC_SYMBOL = { 'TVC:US02Y': 'US2Y' };

async function fetchFromCnbc(tvSymbol) {
  const cnbcSymbol = CNBC_SYMBOL[tvSymbol];
  if (!cnbcSymbol) throw new Error(`sem mapeamento CNBC pra ${tvSymbol}`);
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(cnbcSymbol)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  const q = json?.FormattedQuoteResult?.FormattedQuote?.[0];
  if (!q?.last) throw new Error('resposta da CNBC sem cotação');
  const price = parseFloat(q.last); // vem como string "4.218%"
  const prevClose = q.previous_day_closing != null ? parseFloat(q.previous_day_closing) : null;
  if (!Number.isFinite(price)) throw new Error('preço inválido da CNBC');
  return { price, prevClose, date: null, source: 'cnbc' };
}

async function fetchFromTradingView(tvSymbol) {
  const r = await fetch('https://scanner.tradingview.com/global/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      symbols: { tickers: [tvSymbol], query: { types: [] } },
      columns: ['close', 'change_abs'],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  const row = json.data?.[0]?.d;
  if (!row || row[0] == null) throw new Error(`símbolo ${tvSymbol} não encontrado`);
  const [close, changeAbs] = row;
  // `change_abs` já vem do TradingView como Δ em pontos-percentuais contra o fechamento
  // anterior — mesma convenção usada pro DI Futuro em api/b3.js.
  const prevClose = changeAbs != null ? close - changeAbs : null;
  return { price: close, prevClose, date: null, source: 'tradingview' };
}

async function fetchQuote(tvSymbol, res) {
  try {
    return res.json(await fetchFromCnbc(tvSymbol));
  } catch (cnbcErr) {
    try {
      return res.json(await fetchFromTradingView(tvSymbol));
    } catch (tvErr) {
      return res.status(500).json({ error: `CNBC: ${cnbcErr.message} · TradingView: ${tvErr.message}` });
    }
  }
}

async function fetchHistory(tvSymbol, res) {
  try {
    const history = await fetchTradingViewHistory(tvSymbol);
    if (!history.length) return res.status(502).json({ error: 'TradingView: sem dados retornados' });
    return res.json({ history, source: 'tradingview' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=45, stale-while-revalidate=120');

  const symbol = req.query.symbol;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório (ex: TVC:US02Y)' });

  return req.query.history ? fetchHistory(symbol, res) : fetchQuote(symbol, res);
}
