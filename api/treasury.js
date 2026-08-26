// Yields de treasury americano via TradingView — arquivo próprio, separado de api/b3.js (que
// é só DI Futuro/B3 brasileira) mesmo compartilhando a mesma infra de TradingView (protocolo
// WebSocket de histórico em lib/tradingview-history.js): não faz sentido um yield americano
// viver dentro de um arquivo chamado "b3".
//
// Motivo de existir: o Yahoo Finance não tem um ticker líquido pro yield de 2 anos (só um
// contrato futuro com volume irrelevante, confirmado ao vivo) — TVC:US02Y no TradingView é o
// yield à vista de verdade. O de 10 anos (^TNX) já tem histórico bom no Yahoo Finance e
// continua vindo de lá (ver index.html — card "Juros Globais" e CLOSE_REPORT_CONFIG).
//
// GET /api/treasury?symbol=TVC:US02Y              → cotação atual
// GET /api/treasury?symbol=TVC:US02Y&history=1    → histórico diário (~2 anos)
import { fetchTradingViewHistory } from '../lib/tradingview-history.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchQuote(tvSymbol, res) {
  try {
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
    return res.json({ price: close, prevClose, date: null, source: 'tradingview' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
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
  res.setHeader('Cache-Control', 'no-store');

  const symbol = req.query.symbol;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório (ex: TVC:US02Y)' });

  return req.query.history ? fetchHistory(symbol, res) : fetchQuote(symbol, res);
}
