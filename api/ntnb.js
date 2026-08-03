// Taxas NTN-B via arquivo diário da ANBIMA. Fundido com o antigo api/ntnb-history.js nessa
// sessão — o plano Hobby do Vercel limita a 12 Serverless Functions por deployment, e esse
// projeto bateu exatamente nesse teto; consolidar endpoints da mesma fonte numa função só é
// a forma de abrir espaço sem cortar funcionalidade. Ver METODOLOGIA.md seção 19.1.1.
//
// GET /api/ntnb            → snapshot do dia (comportamento de sempre)
// GET /api/ntnb?days=N     → histórico (era GET /api/ntnb-history?days=N)
const TARGETS = ['20280815', '20290515', '20300815', '20320815', '20350515', '20450515'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function lastBusinessDays(n) {
  const days = [];
  const d = new Date();
  while (days.length < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      days.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return days;
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
  const [day, month, year] = dt.split('/');
  const yy = year.slice(-2);
  const filename = `ms${yy}${month}${day}.txt`;
  const url = `https://www.anbima.com.br/informacoes/merc-sec/arqs/${filename}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  return parseRatesFromText(await r.text());
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

  if (req.query.days != null) return handleHistory(req.query.days, res);
  return handleSnapshot(res);
}
