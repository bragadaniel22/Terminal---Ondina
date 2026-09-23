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
// limitada, e essa janela é bem mais curta do que parecia: confirmado ao vivo em 2026-09-23 que
// o arquivo mais antigo ainda disponível é de 11/09/2026 (~9 dias úteis) — semanas antes disso
// já testamos e o "mais antigo" era 23/02/2026, ou seja essa "janela" ROLA junto com a data
// atual, não é um corte fixo. Isso quebra qualquer plano de "buscar histórico direto da ANBIMA
// dia a dia" pra janelas de 1M+ — ver fetchTesouroDiretoHistory abaixo pra como isso é resolvido
// pra 4 dos 6 vencimentos. A base de Δ ano (31/dez do ano anterior) some da fonte ao vivo bem
// antes de completar o ano seguinte. O Daniel mantém a planilha manualmente com o dado real da
// ANBIMA capturado enquanto ainda estava disponível — mas essa captura manual TEM UM BURACO REAL
// de 6 meses (20/02/2026 a 31/08/2026, confirmado lendo a planilha: a tarefa agendada
// "SalvarNtnbMensal" aparentemente não rodou nesse intervalo) que não tem como ser recuperado
// retroativamente (a ANBIMA não guarda mais esses dias).
const TARGETS = ['20280815', '20290515', '20300815', '20320815', '20350515', '20450515'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Só ~9 dias úteis de retenção real na ANBIMA (ver nota acima) — tentar muito mais do que isso
// só gera 404 em massa e mais chance de a ANBIMA derrubar/atrasar conexões concorrentes. Uma
// folga de ~15 cobre variação de feriados sem desperdiçar requisições.
const ANBIMA_LIVE_WINDOW_DAYS = 15;

// A ANBIMA só guarda o arquivo diário por poucos dias (ver acima), então pra qualquer range
// maior que ~2-3 semanas o histórico "ao vivo" precisa de outra fonte. O Tesouro Direto publica
// uma série histórica DIÁRIA completa (desde 2004, sem janela de retenção) com preço/taxa de
// TODOS os títulos que já ofereceu — inclui 4 dos 6 vencimentos de NTN-B que a ANBIMA cobre no
// mercado secundário (não tem 2028 nem 2030 — não são ofertados a pessoa física atualmente).
// A taxa do Tesouro Direto (compra/venda de varejo) não é idêntica à taxa indicativa da ANBIMA
// (mercado secundário institucional), mas as duas seguem a mesma curva de perto — é a melhor
// fonte gratuita com retenção real de histórico que existe pra isso. Usamos a MÉDIA entre
// compra e venda como aproximação de "taxa de mercado".
const TESOURO_MATURITY_MAP = { '2029': '15/05/2029', '2032': '15/08/2032', '2035': '15/05/2035', '2045': '15/05/2045' };
const TESOURO_CSV_URL = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv';

// Cache em memória do processo — só ajuda quando o Vercel reaproveita uma instância "quente"
// entre requisições (não garantido, mas gratuito quando acontece); cada cold start baixa de
// novo. O arquivo é ~14MB, mas é UMA requisição só (bem mais confiável que dezenas de requisições
// concorrentes pra ANBIMA, uma por dia).
let tesouroCsvCache = null;

async function fetchTesouroDiretoHistory() {
  if (tesouroCsvCache) return tesouroCsvCache;
  const r = await fetch(TESOURO_CSV_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Tesouro Direto CSV: ${r.status}`);
  const text = await r.text();
  const maturityToYear = Object.fromEntries(Object.entries(TESOURO_MATURITY_MAP).map(([y, m]) => [m, y]));
  // Map<"DD/MM/AAAA", {year: rate}> — igual ao formato de `history` já usado pro resto do
  // arquivo, só que indexado por data pra merge O(1) em vez de O(n) mais adiante.
  const byDate = new Map();
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) { // i=1 pula o cabeçalho
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(';');
    if (cols.length < 5 || cols[0] !== 'Tesouro IPCA+') continue; // só o zero-coupon "puro" — mesma família das NTN-B da ANBIMA, não a variante "com Juros Semestrais"
    const year = maturityToYear[cols[1]];
    if (!year) continue;
    const compra = parseFloat(cols[3].replace(',', '.'));
    const venda = parseFloat(cols[4].replace(',', '.'));
    if (isNaN(compra) || isNaN(venda)) continue;
    const dt = cols[2];
    if (!byDate.has(dt)) byDate.set(dt, {});
    byDate.get(dt)[year] = Math.round((compra + venda) / 2 * 10000) / 10000;
  }
  tesouroCsvCache = byDate;
  return byDate;
}

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

// Restringe um objeto de taxas só às chaves pedidas — usado pra planilha manual só preencher
// 2028/2030 (os 2 vencimentos que o Tesouro Direto não cobre), nunca sobrescrevendo os outros 4
// que já vieram do Tesouro Direto (metodologia diferente — não dá pra misturar as duas fontes
// pro MESMO vencimento sem criar um "dente" artificial na série).
function pickRates(rates, years) {
  const out = {};
  for (const y of years) if (rates[y] != null) out[y] = rates[y];
  return out;
}

const SPREADSHEET_ONLY_YEARS = ['2028', '2030']; // não cobertos pelo Tesouro Direto

// Detecta, por vencimento, trechos sem NENHUM dado por mais de `maxGapDays` dias corridos — o
// Chart.js já corta a linha sozinho no front (spanGaps numérico), isso aqui é só pra montar o
// aviso textual ("sem dados de X a Y") em vez de deixar o buraco silencioso. `rangeStart` cobre
// o caso da BORDA do período pedido: se o primeiro ponto de um vencimento já nasce bem depois do
// início do range (ex: 2028/2030 só têm dado nos últimos ~15 dias úteis, então numa janela de
// 3M o "buraco" está inteiro ANTES do primeiro ponto, sem nenhum par de pontos consecutivos pra
// comparar) — sem isso esse caso específico passava batido, sem aviso nenhum.
function computeGaps(history, years, rangeStart, maxGapDays = 20) {
  const gaps = [];
  for (const year of years) {
    const points = history.filter((h) => h.rates?.[year] != null).map((h) => ({ date: h.date, d: toDate(h.date) }));
    if (points.length && (points[0].d - rangeStart) / 86400000 > maxGapDays) {
      gaps.push({ year, from: `${String(rangeStart.getDate()).padStart(2, '0')}/${String(rangeStart.getMonth() + 1).padStart(2, '0')}/${rangeStart.getFullYear()}`, to: points[0].date });
    }
    for (let i = 1; i < points.length; i++) {
      const diffDays = (points[i].d - points[i - 1].d) / 86400000;
      if (diffDays > maxGapDays) gaps.push({ year, from: points[i - 1].date, to: points[i].date });
    }
  }
  return gaps;
}

async function handleHistory(daysParam, res) {
  const requested = parseInt(daysParam, 10);
  // até 1 ano de pregões (260 dias úteis)
  const spanDays = Math.min(isNaN(requested) ? 65 : requested, 260);
  const allBizDays = lastBusinessDays(spanDays); // mais recente primeiro

  // Só busca na ANBIMA os dias com chance real de existir (ver ANBIMA_LIVE_WINDOW_DAYS acima)
  // — pedir mais do que isso é só 404 em massa (e mais risco de a ANBIMA derrubar conexão sob
  // concorrência). O resto do range (Tesouro Direto + planilha) é buscado só se sobrar buraco.
  const liveDays = allBizDays.slice(0, Math.min(allBizDays.length, ANBIMA_LIVE_WINDOW_DAYS));

  const results = await Promise.allSettled(liveDays.map(async (dt) => {
    const rates = await fetchDayFile(dt);
    if (!rates || !Object.keys(rates).length) return null;
    return { date: dt, rates };
  }));

  const byDate = new Map();
  results.forEach((r) => { if (r.status === 'fulfilled' && r.value) byDate.set(r.value.date, r.value.rates); });

  const oldestRequested = toDate(allBizDays[allBizDays.length - 1]);
  const liveDates = [...byDate.keys()].sort((a, b) => toDate(a) - toDate(b));
  const oldestLive = liveDates.length ? toDate(liveDates[0]) : null;

  // Pra tudo antes do que a ANBIMA ainda tem ao vivo: Tesouro Direto (série diária completa,
  // sem janela de retenção — ver nota grande no topo do arquivo) pros 4 vencimentos que ele
  // oferece, e a planilha manual (pontos esparsos) só pros 2 que sobram. Cada fonte tem seu
  // próprio try/catch — uma falhar (rede fora do ar, planilha ausente) nunca derruba o
  // endpoint, só fica sem aquele complemento específico.
  if (!oldestLive || oldestLive > oldestRequested) {
    try {
      const tesouro = await fetchTesouroDiretoHistory();
      for (const [dt, rates] of tesouro) {
        const d = toDate(dt);
        if (d >= oldestRequested && (!oldestLive || d < oldestLive)) {
          const existing = byDate.get(dt) || {};
          byDate.set(dt, { ...rates, ...existing }); // dado ao vivo, se por acaso já existir nessa data, sempre prevalece
        }
      }
    } catch (e) { /* sem Tesouro Direto — segue só com o que tiver */ }

    try {
      const wb = await loadTaxasAntigasWorkbook();
      const spreadsheetHistory = getSpreadsheetHistory(wb).filter((s) => {
        const d = toDate(s.date);
        return d >= oldestRequested && (!oldestLive || d < oldestLive);
      });
      for (const s of spreadsheetHistory) {
        const only2028e2030 = pickRates(s.rates, SPREADSHEET_ONLY_YEARS);
        if (!Object.keys(only2028e2030).length) continue;
        const existing = byDate.get(s.date) || {};
        byDate.set(s.date, { ...only2028e2030, ...existing });
      }
    } catch (e) { /* planilha ausente/corrompida — segue só com o que tiver */ }
  }

  const history = [...byDate.entries()]
    .map(([date, rates]) => ({ date, rates }))
    .sort((a, b) => toDate(a.date) - toDate(b.date));

  if (!history.length) return res.status(500).json({ error: 'NTN-B: sem dados disponíveis no período' });

  const gaps = computeGaps(history, [...Object.keys(TESOURO_MATURITY_MAP), ...SPREADSHEET_ONLY_YEARS], oldestRequested);
  return res.json({ history, gaps });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.query.staticAnchors != null) return handleStaticAnchors(res);
  if (req.query.dates != null) return handleDatesMode(req.query.dates, res);
  if (req.query.days != null) return handleHistory(req.query.days, res);
  return handleSnapshot(res);
}
