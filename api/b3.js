// Cotação + histórico de DI Futuro. Fundido com o antigo api/di-history.js numa sessão
// anterior — o plano Hobby do Vercel limita a 12 Serverless Functions por deployment, e esse
// projeto bateu exatamente nesse teto; consolidar endpoints do mesmo instrumento numa função
// só é a forma de abrir espaço sem cortar funcionalidade. Ver METODOLOGIA.md seção 19.1.1.
//
// GET /api/b3?s=DI1F30              → cotação atual (comportamento de sempre)
// GET /api/b3?s=DI1F30&history=1    → histórico diário (~2 anos), era GET /api/di-history?symbol=
//
// Yields de treasury americano (ex: TVC:US02Y) NÃO ficam aqui — têm arquivo próprio em
// api/treasury.js, mesmo usando a mesma infra de TradingView (protocolo WebSocket
// compartilhado em lib/tradingview-history.js) — não faz sentido um yield americano viver
// dentro de um arquivo chamado "b3" (a bolsa brasileira).
import { fetchTradingViewHistory } from '../lib/tradingview-history.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchFromB3(symbol) {
  const url = `https://cotacao.b3.com.br/mds/api/v1/InstrumentQuotation/${encodeURIComponent(symbol)}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  });
  const data = await r.json();
  if (data.BizSts?.cd !== 'OK' || !data.Trad?.length) throw new Error('sem negócios');
  const qtn = data.Trad[0].scty.SctyQtn;
  // `prcFlcn` é a variação % da B3 já calculada contra o AJUSTE DO DIA ANTERIOR (confirmado
  // ao vivo: dividir curPrc por (1+prcFlcn/100) devolve o mesmo valor de ajuste anterior em
  // fetches sucessivos, enquanto curPrc muda) — diferente de `opngPric`, que é só o preço do
  // primeiro negócio de HOJE. Usar opngPric como base do Δ (como antes) mostrava 0,00 pp
  // sempre que ainda não tinha havido um segundo negócio no dia (contratos menos líquidos),
  // mesmo com uma variação real e não-nula contra o ajuste anterior.
  const prevClose = qtn.prcFlcn != null ? qtn.curPrc / (1 + qtn.prcFlcn / 100) : null;
  return { price: qtn.curPrc, open: qtn.opngPric, prevClose, date: data.Msg?.dtTm ?? null, source: 'b3' };
}

// Fallback: a B3 às vezes fica fora do ar por completo (confirmado via HTTP 520 do Cloudflare
// na origem, não só no endpoint específico) — sem retry que resolva, já que é queda total.
// Usa o scanner (não-oficial, mas estável) do TradingView, que republica dados da B3 com
// ~15min de atraso (`update_mode: "delayed_streaming_900"`). Endpoint certo é `/global/scan`
// — `/brazil/scan` (o mais óbvio de tentar) só cobre ações, devolve vazio pra futuros.
// Símbolo TradingView usa ano com 4 dígitos (`DI1F2030`), diferente do formato da B3
// (`DI1F30`) — conversão simples: insere "20" antes dos 2 dígitos finais do ano.
async function fetchFromTradingView(symbol) {
  const tvSymbol = symbol.replace(/(\d{2})$/, '20$1');
  const r = await fetch('https://scanner.tradingview.com/global/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      symbols: { tickers: [`BMFBOVESPA:${tvSymbol}`], query: { types: ['futures'] } },
      columns: ['close', 'open', 'change_abs'],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  const row = json.data?.[0]?.d;
  if (!row || row[0] == null) throw new Error(`símbolo ${tvSymbol} não encontrado`);
  const [close, open, changeAbs] = row;
  // `change_abs` já vem do TradingView como a diferença em pontos-percentuais contra o
  // fechamento anterior — mesma correção aplicada ao lado B3 (ver fetchFromB3 acima).
  const prevClose = changeAbs != null ? close - changeAbs : null;
  return { price: close, open: open ?? null, prevClose, date: null, source: 'tradingview' };
}

async function fetchQuote(symbol, res) {
  try {
    return res.json(await fetchFromB3(symbol));
  } catch (b3Err) {
    try {
      return res.json(await fetchFromTradingView(symbol));
    } catch (tvErr) {
      return res.status(500).json({ error: `B3: ${b3Err.message} · TradingView: ${tvErr.message}` });
    }
  }
}

async function fetchHistory(symbol, res) {
  if (!/^DI1F\d{2}$/.test(symbol)) {
    return res.status(400).json({ error: 'symbol inválido (esperado ex: DI1F30)' });
  }
  const tvSymbol = `BMFBOVESPA:${symbol.replace(/(\d{2})$/, '20$1')}`;
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

  const symbol = req.query.s || 'DI1F30';

  if (req.query.history) return fetchHistory(symbol, res);
  return fetchQuote(symbol, res);
}
