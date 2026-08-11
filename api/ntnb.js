// Taxas NTN-B via arquivo diário da ANBIMA. Fundido com o antigo api/ntnb-history.js nessa
// sessão — o plano Hobby do Vercel limita a 12 Serverless Functions por deployment, e esse
// projeto bateu exatamente nesse teto; consolidar endpoints da mesma fonte numa função só é
// a forma de abrir espaço sem cortar funcionalidade. Ver METODOLOGIA.md seção 19.1.1.
//
// GET /api/ntnb            → snapshot do dia (comportamento de sempre)
// GET /api/ntnb?days=N     → histórico (era GET /api/ntnb-history?days=N)
// GET /api/ntnb?dates=DD/MM/YYYY,... → taxas em datas específicas (relatório de Fechamento,
// seção 6.8 da METODOLOGIA) — um único arquivo diário já traz as 6 taxas de uma vez, então isso
// cobre todos os vencimentos NTN-B do relatório com só 1-2 requisições por data, ao contrário da
// ETTJ (que precisa de 1 requisição por vértice).
// GET /api/ntnb?ytdAnchor=YYYY → taxa do último pregão de dezembro/YYYY, via Tesouro Direto (ver
// handleYtdAnchor abaixo) — usado quando a ANBIMA já não retém mais essa data (retenção de
// ~5-6 meses do arquivo diário faz a base de Δ ano sumir a partir de meados do ano seguinte).
const TARGETS = ['20280815', '20290515', '20300815', '20320815', '20350515', '20450515'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Tesouro Nacional publica um CSV público (~15MB) com o histórico DIÁRIO completo (desde ~2011,
// atualizado todo dia útil) de todos os títulos do Tesouro Direto, incluindo o equivalente de
// varejo da NTN-B ("Tesouro IPCA+ com Juros Semestrais"). Isso resolve o problema de retenção da
// ANBIMA pra 4 dos 6 vencimentos que o relatório acompanha — **2028 e 2029 não têm equivalente
// no Tesouro Direto** (verificado ao vivo: 15/08/2028 não existe em nenhum título do catálogo, e
// 15/05/2029 só existe como "Tesouro IPCA+" sem juros semestrais, um título de estrutura
// diferente — NTN-B Principal/zero-coupon, não a NTN-B com cupom que a ANBIMA reporta). Pra esses
// dois, o Δ ano continua "n/d" — não tem fonte pública alternativa confiável.
const TD_CSV_URL = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv';
const TD_TITLE = 'Tesouro IPCA+ com Juros Semestrais';
const TD_MATURITY_MAP = { '2030': '15/08/2030', '2032': '15/08/2032', '2035': '15/05/2035', '2045': '15/05/2045' };

function businessDaysBackFrom(startDate, n) {
  const days = [];
  const d = new Date(startDate);
  while (days.length < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      days.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return days;
}

function lastBusinessDays(n) {
  return businessDaysBackFrom(new Date(), n);
}

function parseBrDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function toDate(dt) {
  const [d, m, y] = dt.split('/');
  return new Date(+y, +m - 1, +d);
}

function parseRatesFromText(text) {
  const rates = {};
  for (const line of text.split('\n')) {
    const cols = line.split('@');
    if (cols[0]?.trim() !== 'NTN-B') continue;
    const mat = cols[4]?.trim();
    if (TARGETS.includes(mat)) {
      const rate = parseFloat(cols[7]?.trim().replace(',', '.'));
      if (!isNaN(rate)) rates[mat.slice(0, 4)] = rate;
    }
  }
  return rates;
}

async function fetchDayFile(dt) {
  try {
    const [day, month, year] = dt.split('/');
    const yy = year.slice(-2);
    const filename = `ms${yy}${month}${day}.txt`;
    const url = `https://www.anbima.com.br/informacoes/merc-sec/arqs/${filename}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return parseRatesFromText(await r.text());
  } catch {
    return null;
  }
}

// maxTries=3 com timeout de 3s por tentativa — mesmo raciocínio do fetchEttjNear em
// api/anbima.js: evitar estourar o limite de ~10s de função do Vercel Hobby.
async function fetchNtnbNear(dateStr, maxTries = 3) {
  const anchor = parseBrDate(dateStr);
  if (!anchor) return null;
  const candidates = businessDaysBackFrom(anchor, maxTries);
  for (const dt of candidates) {
    const rates = await fetchDayFile(dt);
    if (rates && Object.keys(rates).length > 0) return { date: dt, rates };
  }
  return null;
}

async function handleDatesMode(datesParam, res) {
  const requested = String(datesParam).split(',').map(s => s.trim()).filter(Boolean);
  const results = await Promise.all(requested.map(dt => fetchNtnbNear(dt)));
  return res.json({ results });
}

// Nota importante sobre a taxa devolvida: Tesouro Direto cobra um spread de varejo sobre a
// curva institucional da ANBIMA (a taxa de compra é sempre um pouco mais alta, a de venda um
// pouco mais baixa) — usamos o PONTO MÉDIO entre compra e venda como aproximação da taxa
// institucional. O front-end (fetchNtnbBatch) usa esse valor só como base de comparação pro
// Δ ano (nunca como "Fechamento" exibido, que continua sempre vindo puro da ANBIMA), então um
// pequeno viés de spread aqui afeta o Δ ano em poucos bps, não os outros números do relatório.
async function handleYtdAnchor(yearParam, res) {
  const year = parseInt(yearParam, 10);
  if (!year || year < 2011) return res.status(400).json({ error: 'ano inválido' });

  try {
    const r = await fetch(TD_CSV_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(35000) });
    if (!r.ok) return res.status(502).json({ error: `Tesouro Direto: HTTP ${r.status}` });
    const text = await r.text();

    // indexa só as linhas do título que interessa (vencimento;dataBase -> colunas) — evita
    // varrer o arquivo inteiro (~175 mil linhas) uma vez por vencimento/tentativa
    const index = new Map();
    const prefix = TD_TITLE + ';';
    for (const line of text.split('\n')) {
      if (!line.startsWith(prefix)) continue;
      const cols = line.split(';');
      index.set(`${cols[1]};${cols[2]}`, cols);
    }

    const rates = {};
    let usedDate = null;
    for (const [mat, tdMaturity] of Object.entries(TD_MATURITY_MAP)) {
      // anda pra trás dia a dia a partir de 31/dez (cobre feriado/fim de semana de virada de ano)
      for (let back = 0; back < 8; back++) {
        const d = new Date(year, 11, 31 - back);
        const dt = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        const cols = index.get(`${tdMaturity};${dt}`);
        if (cols) {
          const compra = parseFloat(cols[3].replace(',', '.'));
          const venda = parseFloat(cols[4].replace(',', '.'));
          if (!isNaN(compra) && !isNaN(venda)) {
            rates[mat] = (compra + venda) / 2;
            usedDate = dt;
          }
          break;
        }
      }
    }

    if (!Object.keys(rates).length) return res.status(500).json({ error: 'Tesouro Direto: sem dados pro período' });
    return res.json({ year, date: usedDate, rates, source: 'tesouro-direto' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleSnapshot(res) {
  const dates = lastBusinessDays(5);
  for (const dt of dates) {
    try {
      const rates = await fetchDayFile(dt);
      if (rates && Object.keys(rates).length > 0) return res.json({ rates, date: dt });
    } catch (_) {}
  }
  return res.status(500).json({ error: 'NTN-B: sem dados disponíveis' });
}

async function handleHistory(daysParam, res) {
  const requested = parseInt(daysParam, 10);
  // até 1 ano de pregões (260 dias úteis)
  const spanDays = Math.min(isNaN(requested) ? 65 : requested, 260);
  const allBizDays = lastBusinessDays(spanDays); // mais recente primeiro

  // trava de segurança: cada dia é um arquivo ANBIMA buscado individualmente (não existe
  // endpoint de histórico em lote). Pra janelas maiores (6M/1A), amostramos 1 em cada N
  // dias em vez de buscar todos — mantém o total de requisições limitado (~90 no pior
  // caso) sem estourar o timeout da função serverless. Janelas menores (5D/1M/3M) sempre
  // saem em resolução diária completa, já que cabem dentro do limite sozinhas.
  const MAX_SAMPLES = 90;
  const stride = Math.max(1, Math.ceil(spanDays / MAX_SAMPLES));
  const dates = allBizDays.filter((_, i) => i % stride === 0);

  const results = await Promise.allSettled(dates.map(async (dt) => {
    const rates = await fetchDayFile(dt);
    if (!rates || !Object.keys(rates).length) return null;
    return { date: dt, rates };
  }));

  const history = results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean)
    .sort((a, b) => toDate(a.date) - toDate(b.date));

  if (!history.length) return res.status(500).json({ error: 'NTN-B: sem dados disponíveis no período' });
  return res.json({ history });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.query.ytdAnchor != null) return handleYtdAnchor(req.query.ytdAnchor, res);
  if (req.query.dates != null) return handleDatesMode(req.query.dates, res);
  if (req.query.days != null) return handleHistory(req.query.days, res);
  return handleSnapshot(res);
}
