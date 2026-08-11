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
// GET /api/ntnb?staticAnchors=1 → bases de Δ mês/Δ ano vindas da planilha "Taxas Antigas
// NTNB.xlsx" (ver handleStaticAnchors abaixo) — a ANBIMA só retém ~5-6 meses de arquivo diário,
// então a base de Δ ano (31/dez do ano anterior) some por volta de meados do ano seguinte. O
// Daniel mantém essa planilha manualmente (atualiza 1x/mês e 1x/ano) com o dado real da ANBIMA
// capturado enquanto ainda estava disponível.
const TARGETS = ['20280815', '20290515', '20300815', '20320815', '20350515', '20450515'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

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

// Lê a planilha "Taxas Antigas NTNB.xlsx" (raiz do repo, ao lado de index.html) — duas abas,
// "Mês Anterior" e "Ano Anterior", cada uma com a data de referência em C2 e os 6 vencimentos
// em C5:C10/D5:D10. O Daniel atualiza essa planilha manualmente (1x/mês, 1x/ano) e sobe de novo
// pelo fluxo normal de upload no GitHub — nenhum código muda quando ele atualiza os números.
async function handleStaticAnchors(res) {
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const XLSX = await import('xlsx');

    const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Taxas Antigas NTNB.xlsx');
    const wb = XLSX.read(readFileSync(filePath), { type: 'buffer', cellDates: true });

    const readSheet = (sheetName) => {
      const ws = wb.Sheets[sheetName];
      const dateCell = ws?.['C2'];
      if (!dateCell?.v) return null;
      const d = dateCell.v instanceof Date ? dateCell.v : null;
      if (!d) return null;
      const date = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      const rates = {};
      for (let row = 5; row <= 10; row++) {
        const label = ws[`C${row}`]?.v;
        const val = ws[`D${row}`]?.v;
        if (label != null && val != null) {
          const year = String(label).replace(/\D/g, '');
          rates[year] = Math.round(val * 100 * 10000) / 10000; // 0.0847 -> 8.47
        }
      }
      return Object.keys(rates).length ? { date, rates } : null;
    };

    const month = readSheet('Mês Anterior');
    const year = readSheet('Ano Anterior');
    if (!month && !year) return res.status(500).json({ error: 'Taxas Antigas NTNB.xlsx: nenhuma aba reconhecida' });
    return res.json({ month, year });
  } catch (e) {
    return res.status(500).json({ error: `Taxas Antigas NTNB.xlsx: ${e.message}` });
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

  if (req.query.staticAnchors != null) return handleStaticAnchors(res);
  if (req.query.dates != null) return handleDatesMode(req.query.dates, res);
  if (req.query.days != null) return handleHistory(req.query.days, res);
  return handleSnapshot(res);
}
