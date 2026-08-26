// Histórico diário via protocolo WebSocket do TradingView — compartilhado por api/b3.js (DI
// Futuro) e api/treasury.js (yields de treasury americano). Fica FORA de api/ de propósito:
// arquivos dentro de api/ viram uma Serverless Function cada no Vercel (teto de 12 no plano
// Hobby, ver METODOLOGIA.md seção 19.1.1) — um módulo compartilhado importado por vários
// arquivos de api/ não conta pra esse teto, só arquivo novo DENTRO de api/ contaria.
//
// Usamos isso porque toda alternativa mais simples testada (scraping do ADVFN, sistema de
// Boletim Diário da B3) roda atrás de proteção anti-bot (Cloudflare) que bloqueia
// especificamente tráfego de datacenter/nuvem como o do Vercel — confirmado bloqueando o
// ADVFN em produção numa sessão anterior. O scanner REST do TradingView (usado à parte, em
// cada arquivo consumidor) não expõe histórico, só cotação atual; pra histórico o TradingView
// só disponibiliza via esse protocolo de streaming.
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
import WebSocket from 'ws';

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

export function fetchTradingViewHistory(tvSymbol, bars = BARS_REQUESTED) {
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
