// Proxy de taxas oficiais de referência — Taxa do BCE (era api/ecb.js) + fontes alternativas
// pro CDI 12M/Selic quando a chamada direta do browser pro BCB (api.bcb.gov.br) falha. CDI 12M
// e Selic são hoje os ÚNICOS cards do terminal chamados direto do browser pro provedor externo,
// sem proxy nem fallback (ver METODOLOGIA seção 6.1) — confirmado ao vivo que a API do BCB fica
// instável/dá timeout de vez em quando (o Daniel viu isso acontecer, e reproduzi aqui também).
//
// Renomeado de api/ecb.js (que só tinha a rota do BCE) — não cria arquivo novo porque o Vercel
// Hobby está no teto de 12 Serverless Functions (seção 19.1.1); as três rotas aqui são a mesma
// categoria de dado ("taxa oficial de referência de banco central/indicador macro BR"), só que
// vindo de fontes diferentes.
//
// GET /api/rates?source=ecb       → Taxa de Juros do BCE (comportamento de sempre, era /api/ecb)
// GET /api/rates?source=selic     → Selic via BrasilAPI — fallback pro card Selic; MESMA
//                                    métrica (taxa atual), só fonte diferente.
// GET /api/rates?source=cdi12m    → CDI acumulado 12 meses via brasilindicadores.com.br —
//                                    fallback pro card CDI 12M. Sem API JSON nesse site, então
//                                    é scraping da tabela mensal da página. Granularidade
//                                    MENSAL (não diária) — é a mesma métrica do card (acumulado
//                                    dos últimos 12 meses), só que atualizada 1x/mês em vez de
//                                    todo dia; ainda assim mais correto que aproximar pela taxa
//                                    do dia (que é um número diferente, não intercambiável).

async function fetchEcb(res) {
  const url = 'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?format=jsondata&lastNObservations=1';
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return res.status(r.status).json({ error: `ECB HTTP ${r.status}` });
  const d = await r.json();
  const seriesMap = d?.dataSets?.[0]?.series;
  if (!seriesMap) return res.status(500).json({ error: 'ECB: sem dataSets' });
  const sid = Object.keys(seriesMap)[0];
  if (!sid) return res.status(500).json({ error: 'ECB: sem série' });
  const obs = seriesMap[sid]?.observations;
  if (!obs) return res.status(500).json({ error: 'ECB: sem observações' });
  const key = Object.keys(obs)[0];
  const v = obs[key][0];
  const date = d?.structure?.dimensions?.observation?.[0]?.values?.[parseInt(key)]?.id ?? '—';
  return res.json({ v, date });
}

async function fetchSelicFallback(res) {
  const r = await fetch('https://brasilapi.com.br/api/taxas/v1/selic', { headers: { Accept: 'application/json' } });
  if (!r.ok) return res.status(r.status).json({ error: `BrasilAPI HTTP ${r.status}` });
  const d = await r.json();
  if (typeof d?.valor !== 'number') return res.status(500).json({ error: 'BrasilAPI: sem valor' });
  return res.json({ v: d.valor, date: null, source: 'brasilapi' });
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// A página lista o ano corrente numa tabela mensal (Mês | CDI no mês | Acumulado 12 meses |
// Acumulado no ano) e o ano anterior noutra tabela, cada uma recomeçando em "janeiro" — pegar
// só "a última linha da página" pegaria dezembro do ano ANTERIOR por engano (testado ao vivo:
// a tabela de 2025 vem depois da de 2026 no HTML). Em vez disso, corta no segundo "janeiro"
// que aparecer (início da tabela do ano anterior) e usa a última linha ANTES desse corte.
function parseCdi12mHtml(html) {
  const rowRe = /<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<\/tr>/g;
  const rows = [...html.matchAll(rowRe)];
  let cut = rows.length;
  let sawJaneiro = false;
  for (let i = 0; i < rows.length; i++) {
    const mes = rows[i][1].trim().toLowerCase();
    if (mes.startsWith('janeiro')) {
      if (sawJaneiro) { cut = i; break; }
      sawJaneiro = true;
    }
  }
  const currentYearRows = rows.slice(0, cut);
  if (!currentYearRows.length) return null;
  const last = currentYearRows[currentYearRows.length - 1];
  const mes = last[1].trim();
  const acumulado12m = parseFloat(last[3].trim().replace('%', '').replace(',', '.'));
  if (!Number.isFinite(acumulado12m)) return null;
  return { mes, acumulado12m };
}

async function fetchCdi12mFallback(res) {
  const r = await fetch('https://brasilindicadores.com.br/cdi', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!r.ok) return res.status(r.status).json({ error: `brasilindicadores HTTP ${r.status}` });
  const html = await r.text();
  const parsed = parseCdi12mHtml(html);
  if (!parsed) return res.status(500).json({ error: 'brasilindicadores: não achei a tabela/valor' });
  return res.json({ v: parsed.acumulado12m, date: parsed.mes, source: 'brasilindicadores' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const source = req.query.source || 'ecb';
  try {
    if (source === 'ecb') return await fetchEcb(res);
    if (source === 'selic') return await fetchSelicFallback(res);
    if (source === 'cdi12m') return await fetchCdi12mFallback(res);
    return res.status(400).json({ error: 'source inválido (esperado ecb, selic ou cdi12m)' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
