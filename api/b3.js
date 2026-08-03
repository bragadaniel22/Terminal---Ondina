const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchFromB3(symbol) {
  const url = `https://cotacao.b3.com.br/mds/api/v1/InstrumentQuotation/${encodeURIComponent(symbol)}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  });
  const data = await r.json();
  if (data.BizSts?.cd !== 'OK' || !data.Trad?.length) throw new Error('sem negócios');
  const qtn = data.Trad[0].scty.SctyQtn;
  return { price: qtn.curPrc, open: qtn.opngPric, date: data.Msg?.dtTm ?? null, source: 'b3' };
}

// Fallback: a B3 às vezes fica fora do ar por completo (confirmado via HTTP 520 do Cloudflare
// na origem, não só no endpoint específico) — sem retry que resolva, já que é queda total.
// Usa o scanner (não-oficial, mas estável) do TradingView, que republica dados da B3 com
// ~15min de atraso (`update_mode: "delayed_streaming_900"`). Endpoint certo é `/global/scan`
// — `/brazil/scan` (o mais óbvio de tentar) só cobre ações, devolve vazio pra futuros.
// Símbolo TradingView usa ano com 4 dígitos (`DI1F2030`), diferente do formato da B3/ADVFN
// (`DI1F30`) — conversão simples: insere "20" antes dos 2 dígitos finais do ano.
async function fetchFromTradingView(symbol) {
  const tvSymbol = symbol.replace(/(\d{2})$/, '20$1');
  const r = await fetch('https://scanner.tradingview.com/global/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      symbols: { tickers: [`BMFBOVESPA:${tvSymbol}`], query: { types: ['futures'] } },
      columns: ['close', 'open'],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  const row = json.data?.[0]?.d;
  if (!row || row[0] == null) throw new Error(`símbolo ${tvSymbol} não encontrado`);
  const [close, open] = row;
  return { price: close, open: open ?? null, date: null, source: 'tradingview' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const symbol = req.query.s || 'DI1F30';

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
