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
// NTNB.xlsx" (ver readSpreadsheet* abaixo) — a ANBIMA só retém o arquivo diário por uma janela
// limitada (confirmado ao vivo em 2026-09: o arquivo mais antigo ainda disponível é de
// 23/02/2026 — antes disso dá 404), então a base de Δ ano (31/dez do ano anterior) some da
// fonte ao vivo bem antes de completar o ano seguinte. O Daniel mantém essa planilha
// manualmente com o dado real da ANBIMA capturado enquanto ainda estava disponível.
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

// Excel epoch: 30/12/1899 (compensa o bug histórico do 29/02/1900 herdado do Lotus 1-2-3) —
// mesma conversão já usada em api/bonds.js.
function excelSerialToBr(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
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

async function loadTaxasAntigasWorkbook() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const XLSX = await import('xlsx');
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Taxas Antigas NTNB.xlsx');
  // Sem cellDates: true de propósito — a lib decide Date-vs-número pela FORMATAÇÃO da célula,
  // não pelo valor (bug real já documentado em api/bonds.js seção 16.1.8), então é mais seguro
  // ler tudo como número puro e converter as datas manualmente com excelSerialToBr acima.
  return XLSX.read(readFileSync(filePath), { type: 'buffer' });
}

// Cada "aba de ano" (nome com 4 dígitos, ex "2025", "2026") tem vários blocos de 2 colunas
// (rótulo "NTNB 20XX" | "Taxa Atual") lado a lado, cada bloco antecedido numa das primeiras
// linhas por uma data (serial do Excel) — mesmo padrão de blocos repetidos já usado nas abas
// de histórico da aba BONDS (api/bonds.js), só que aqui a distância entre blocos NÃO é fixa
// (confirmado inspecionando a planilha real: a aba "2025" tem um bloco com 5 colunas de
// distância do resto, que tem 4) — por isso a descoberta de blocos é dinâmica (varre células
// procurando um valor numérico plausível de data), nunca por um passo de coluna fixo.
function parseYearSheet(ws) {
  const snapshots = [];
  if (!ws) return snapshots;
  const colLetter = (n) => {
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  const MAX_COLS = 150; // folga generosa sobre o nº de blocos real de qualquer ano
  for (let c = 1; c <= MAX_COLS; c++) {
    const col = colLetter(c);
    for (let r = 1; r <= 4; r++) {
      const cell = ws[`${col}${r}`];
      if (typeof cell?.v !== 'number' || cell.v <= 40000 || cell.v >= 60000) continue;
      const dateStr = excelSerialToBr(cell.v);
      const rates = {};
      for (let rr = r + 1; rr <= r + 8; rr++) {
        const label = ws[`${col}${rr}`]?.v;
        const val = ws[`${colLetter(c + 1)}${rr}`]?.v;
        if (label != null && typeof val === 'number') {
          const year = String(label).replace(/\D/g, '');
          if (year.length === 4) rates[year] = Math.round(val * 100 * 10000) / 10000; // 0.0803 -> 8.03
        }
      }
      if (Object.keys(rates).length) snapshots.push({ date: dateStr, rates });
      break; // achou a data desse bloco — não olha as outras linhas 1-4 dessa mesma coluna
    }
  }
  return snapshots;
}

// Todas as abas de ano combinadas (histórico esparso capturado manualmente pelo Daniel antes
// do arquivo correspondente sumir do servidor da ANBIMA), ordenadas do mais antigo pro mais
// recente. Novas abas de ano futuras (ex "2027") entram automaticamente, sem mudar código.
function getSpreadsheetHistory(wb) {
  const yearSheets = wb.SheetNames.filter((n) => /^\d{4}$/.test(n));
  const all = yearSheets.flatMap((name) => parseYearSheet(wb.Sheets[name]));
  return all.sort((a, b) => toDate(a.date) - toDate(b.date));
}

// Lê a planilha "Taxas Antigas NTNB.xlsx" (raiz do repo, ao lado de index.html) pras bases de
// Δ mês/Δ ano do relatório de Fechamento. "Mês Anterior" continua sendo uma aba de ponto único
// (data em C2, vencimentos em C5:C10/D5:D10) — inalterada. "Ano Anterior" não existe mais desde
// que o Daniel reestruturou a planilha (2026-09) pra guardar vários snapshots por ano em vez de
// só um ponto fixo — a base de Δ ano agora vem do ÚLTIMO snapshot disponível na aba do ano
// anterior ao atual (ex: em 2026, usa o último snapshot da aba "2025", que por acaso já fica
// bem perto de 31/dez — 30/12/2025 no momento em que isso foi escrito).
async function handleStaticAnchors(res) {
  try {
    const wb = await loadTaxasAntigasWorkbook();

    const monthWs = wb.Sheets['Mês Anterior'];
    let month = null;
    if (monthWs) {
      const serial = monthWs['C2']?.v;
      if (typeof serial === 'number') {
        const rates = {};
        for (let row = 5; row <= 10; row++) {
          const label = monthWs[`C${row}`]?.v;
          const val = monthWs[`D${row}`]?.v;
          if (label != null && typeof val === 'number') {
            const year = String(label).replace(/\D/g, '');
            if (year) rates[year] = Math.round(val * 100 * 10000) / 10000;
          }
        }
        if (Object.keys(rates).length) month = { date: excelSerialToBr(serial), rates };
      }
    }

    const prevYearName = String(new Date().getFullYear() - 1);
    // A ordem de descoberta de parseYearSheet é a ordem das COLUNAS na planilha, não a ordem
    // cronológica (confirmado ao vivo: na aba "2025", a coluna mais à esquerda tem a data
    // 30/12/2025, e datas de novembro aparecem em colunas mais à direita) — sem ordenar por
    // data antes de pegar "o último", pegaria o último bloco DESCOBERTO, não o mais recente.
    const prevYearSnapshots = parseYearSheet(wb.Sheets[prevYearName]).sort((a, b) => toDate(a.date) - toDate(b.date));
    const year = prevYearSnapshots.length ? prevYearSnapshots[prevYearSnapshots.length - 1] : null;

    if (!month && !year) return res.status(500).json({ error: 'Taxas Antigas NTNB.xlsx: nenhuma âncora reconhecida' });
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

  // A ANBIMA não mantém arquivo diário disponível pra sempre (confirmado ao vivo: o mais
  // antigo hoje é de 23/02/2026, tudo antes disso dá 404) — pra janelas grandes (6M/1A) que
  // pedem mais história do que a ANBIMA ainda tem, completa com os snapshots esparsos da
  // planilha "Taxas Antigas NTNB.xlsx" (capturados manualmente pelo Daniel enquanto o dado
  // ainda estava disponível), só pra antes do ponto mais antigo que a ANBIMA devolveu — sem
  // isso o gráfico simplesmente "parava de existir" antes da data real que o usuário pediu,
  // sem nenhuma indicação de que é limitação da fonte, não bug.
  try {
    const oldestRequested = toDate(allBizDays[allBizDays.length - 1]);
    const oldestLive = history.length ? toDate(history[0].date) : null;
    if (!oldestLive || oldestLive > oldestRequested) {
      const wb = await loadTaxasAntigasWorkbook();
      const spreadsheetHistory = getSpreadsheetHistory(wb).filter((s) => {
        const d = toDate(s.date);
        return d >= oldestRequested && (!oldestLive || d < oldestLive);
      });
      if (spreadsheetHistory.length) {
        history.unshift(...spreadsheetHistory);
        history.sort((a, b) => toDate(a.date) - toDate(b.date));
      }
    }
  } catch (e) {
    // Planilha ausente/corrompida não deve derrubar o histórico ao vivo que já funcionou —
    // só fica sem o complemento histórico, como antes desta mudança.
  }

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
