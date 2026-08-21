// Cotação + histórico de DI Futuro. Fundido com o antigo api/di-history.js nessa sessão —
// o plano Hobby do Vercel limita a 12 Serverless Functions por deployment, e esse projeto
// bateu exatamente nesse teto; consolidar endpoints do mesmo instrumento numa função só é a
// forma de abrir espaço sem cortar funcionalidade. Ver METODOLOGIA.md seção 19.1.1.
//
// GET /api/b3?s=DI1F30              → cotação atual (comportamento de sempre)
// GET /api/b3?s=DI1F30&history=1    → histórico diário (~2 anos), era GET /api/di-history?symbol=
import WebSocket from 'ws';

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

// ── Histórico diário via protocolo WebSocket do TradingView (ex api/di-history.js) ──────────
// Usamos isso porque toda alternativa mais simples testada (scraping do ADVFN, sistema de
// Boletim Diário da B3) roda atrás de proteção anti-bot (Cloudflare) que bloqueia
// especificamente tráfego de datacenter/nuvem como o do Vercel — confirmado bloqueando o
// ADVFN em produção nessa sessão. O scanner REST acima não expõe histórico, só cotação
// atual; pra histórico o TradingView só disponibiliza via esse protocolo de streaming.
//
// Protocolo (validado manualmente com um cliente de teste antes de implementar aqui):
// 1. Conecta em wss://data.tradingview.com/socket.io/websocket (header Origin obrigatório)
// 2. Cada mensagem trafega envelopada em `~m~<tamanho>~m~<conteúdo>` — o servidor manda
//    heartbeats nesse mesmo formato como `~h~<n>`, que precisam ser ecoados de volta
//    (senão o servidor derruba a conexão depois de alguns heartbeats sem resposta).
// 3. Sequência de comandos: set_auth_token → chart_create_session → resolve_symbol →
//    create_series (pedindo N barras diárias). Resposta vem em `timescale_update`, com os
//    pontos em `p[1][seriesId].s[].v = [timestamp, open, high, low, close, volume]`.
// 4. Pedindo 500 barras diárias já cobre ~2 anos de histórico (testado e confirmado) — bem
//    mais que os ~3 meses fixos que a ADVFN dava.
const WS_URL = 'wss://data.tradingview.com/socket.io/websocket';
const ORIGIN = 'https://www.tradingview.com';
const BARS_REQUESTED = 500; // ~2 anos de pregões diários

function randomSession(prefix) {
  const rand = Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`;
}

function encodeMessage(method, params) {
  const payload = JSON.stringify({ m: method, p: params });
  return `~m~${payload.length}~m~${payload}`;
}

// Um frame recebido pode conter várias mensagens concatenadas — separa cada uma.
function parseFrames(raw) {
  const frames = [];
  let i = 0;
  while (i < raw.length && raw.startsWith('~m~', i)) {
    const sepIdx = raw.indexOf('~m~', i + 3);
    if (sepIdx === -1) break;
    const len = parseInt(raw.slice(i + 3, sepIdx), 10);
    const start = sepIdx + 3;
    frames.push(raw.slice(start, start + len));
    i = start + len;
  }
  return frames;
}

function fetchTradingViewHistory(tvSymbol, bars = BARS_REQUESTED) {
  return new Promise((resolve, reject) => {
    const chartSession = randomSession('cs');
    const ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });

    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try { ws.close(); } catch (_) {}
      fn(arg);
    };

    const timeoutId = setTimeout(() => finish(reject, new Error('timeout aguardando dados do TradingView')), 8000);

    const send = (method, params) => ws.send(encodeMessage(method, params));

    ws.on('open', () => {
      send('set_auth_token', ['unauthorized_user_token']);
      send('chart_create_session', [chartSession, '']);
      send('resolve_symbol', [chartSession, 'symbol_1', `={"symbol":"${tvSymbol}","adjustment":"splits"}`]);
      send('create_series', [chartSession, 'series_1', 's1', 'symbol_1', '1D', bars]);
    });

    ws.on('message', (data) => {
      const raw = data.toString();
      for (const frame of parseFrames(raw)) {
        if (frame.startsWith('~h~')) {
          ws.send(`~m~${frame.length}~m~${frame}`); // heartbeat — precisa ecoar de volta
          continue;
        }
        let msg;
        try { msg = JSON.parse(frame); } catch (_) { continue; }
        if (msg.m === 'timescale_update') {
          const points = msg.p?.[1]?.series_1?.s;
          if (points?.length) {
            const history = points
              .map((pt) => ({ date: pt.v[0], value: pt.v[4] })) // v = [time, open, high, low, close, volume]
              .filter((h) => Number.isFinite(h.date) && h.value != null);
            finish(resolve, history);
          }
        } else if (['symbol_error', 'series_error', 'critical_error'].includes(msg.m)) {
          finish(reject, new Error(`TradingView: ${msg.m}`));
        }
      }
    });

    ws.on('error', (err) => finish(reject, err));
    ws.on('close', () => finish(reject, new Error('conexão encerrada antes de receber dados')));
  });
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
