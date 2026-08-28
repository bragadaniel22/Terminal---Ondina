// Lê "Bonds Terminal.xlsx" (raiz do repo, ao lado de index.html — mesmo padrão da NTN-B) —
// quatro abas usadas hoje:
// - "Controle Duration 2": foto do dia por papel (nome, ISIN, banco/dealer, volume, bid yield,
//   cupom, duration, spread over treasury).
// - "Bid Yield": histórico diário de bid yield por papel (~5 anos).
// - "Preços": histórico diário de preço (bid close) por papel — só ~58 dos papéis de
//   "Bid Yield" têm série aqui ainda (faltam os papéis internacionais mais recentes).
// - "Treasury": histórico diário de yield de treasuries americanos por vencimento (3M/6M/1Y/
//   2Y/3Y/5Y/7Y/10Y) — pra comparar com o yield do papel na mesma data.
//
// As três abas de histórico usam o mesmo layout de blocos de 3 colunas (rótulo | valor | vazio)
// repetidos lado a lado, mas com pequenas diferenças de alinhamento de linha (ver BLOCK_SHEETS
// abaixo) — "Preços" não tem a linha de status ("#NOME?"/"Updated at...") entre o
// nome/ticker e o sub-cabeçalho, então cabeçalho e dados começam uma linha antes.
//
// O Daniel atualiza essa planilha manualmente e sobe pelo fluxo normal de upload no GitHub —
// nenhum código muda quando os números mudam.
//
// GET /api/bonds                              → snapshot (lista de papéis de "Controle Duration 2")
// GET /api/bonds?history=yield&name=...       → histórico de Bid Yield ("Bid Yield")
// GET /api/bonds?history=price&name=...       → histórico de preço/PU ("Preços")
// GET /api/bonds?history=treasury&maturity=2Y → histórico de yield do treasury ("Treasury")
//
// Cada linha de "Controle Duration 2" é tratada como uma entrada própria — não agrupamos por
// ISIN. Alguns papéis aparecem 2x com bancos/dealers diferentes (ex: "Banco do Brasil 26"
// banco C e "Banco do Brasil" banco B, mesmo ISIN) — parecem ser cotações de corretoras
// diferentes pro mesmo papel; sem regra ainda de qual é "a" cotação oficial, então mostramos
// como vêm na planilha (pendência, ver METODOLOGIA).

// nameRow/headerRow são só documentação (não usados na leitura em si, o bloco é localizado
// pelo texto na linha 1); dataStartRow é o que de fato importa pra achar onde os dados começam.
const BLOCK_SHEETS = {
  yield: { sheet: 'Bid Yield', dataStartRow: 5, valueField: 'value' },
  price: { sheet: 'Preços', dataStartRow: 4, valueField: 'value' },
  treasury: { sheet: 'Treasury', dataStartRow: 5, valueField: 'value' },
};

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Bug real encontrado nessa sessão: com `cellDates: true` (usado antes aqui), a lib `xlsx`
// decide se converte uma célula numérica pra Date com base no FORMATO da célula, não no valor —
// e o bloco de preço de "JP Morgan 33" tinha uma célula com formato de data/hora aplicado por
// engano (confirmado no Excel: o valor exibido lá é um preço normal, 102,0762, não uma data).
// Resultado: a lib devolvia um objeto Date bizarro (ex. "1900-04-11T04:56:11") em vez do preço,
// e a série toda parecia vazia (nenhum valor numérico encontrado). Corrigido lendo SEM
// `cellDates` — toda célula numérica volta como número puro, independente do formato exibido —
// e convertendo a coluna de Timestamp manualmente a partir do serial do Excel.
function excelSerialToBr(serial) {
  if (typeof serial !== 'number') return null;
  // Excel epoch: 30/12/1899 (compensa o bug histórico do 29/02/1900 herdado do Lotus 1-2-3).
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

async function loadWorkbook() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const XLSX = await import('xlsx');
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Bonds Terminal.xlsx');
  return XLSX.read(readFileSync(filePath), { type: 'buffer' });
}

// "Controle Duration 2": Bonds=A, Isin=B, Banco=C, Volume=D, Bid Yield=E, Cupom=F, Duration=G,
// Spread Over Treasury=H (sem coluna vazia entre Duration e Spread — diferente da extinta aba
// "Controle Duration", que tinha D/E/F/G/H/I/J/L com uma coluna K vazia no meio; a "2" trocou de
// aba em 2026-08-26 a pedido do Daniel, com as colunas 3 posições pra esquerda e sem esse gap).
// Cupom vem como fração (0,0503 = 5,03%); os demais campos numéricos já vêm na unidade certa.
//
// A planilha já organiza os papéis por região/categoria com linhas divisórias (nome na coluna
// A, ISIN vazio) — Brasil, Europa, US Consolidado, Preferred, África/Ásia/Latam, Fundos de
// Bonds. Detecta por essa lista fixa (não por "tem nome sem ISIN": alguns papéis de verdade
// também não têm ISIN preenchido, ex. "CLN Volkswagen" — esses continuam ignorados como antes,
// só não viram seção por engano).
const BONDS_SECTIONS = ['Brasil', 'Europa', 'US Consolidado', 'Preferred', 'África/Ásia/Latam', 'Fundos de Bonds'];

function handleSnapshot(wb, res) {
  const ws = wb.Sheets['Controle Duration 2'];
  if (!ws) return res.status(500).json({ error: 'Bonds Terminal.xlsx: aba "Controle Duration 2" não encontrada' });

  // A1 tem a data de referência do snapshot inteiro (serial do Excel, ex.: 46252 = 18/08/2026)
  // — na aba antiga era D1; a "2" trocou de posição junto com as demais colunas.
  const asOfRaw = ws['A1']?.v;
  const asOf = typeof asOfRaw === 'number' ? excelSerialToBr(asOfRaw) : null;

  const bonds = [];
  let section = null;
  for (let r = 3; r <= 186; r++) {
    const name = ws[`A${r}`]?.v;
    const isin = ws[`B${r}`]?.v;
    if (name != null && !isin && BONDS_SECTIONS.includes(String(name).trim())) {
      section = String(name).trim();
      continue;
    }
    if (!name || !isin) continue;
    const num = (cellVal) => (typeof cellVal === 'number' ? cellVal : null);
    bonds.push({
      name: String(name).trim(),
      isin: String(isin).trim(),
      section,
      banco: ws[`C${r}`]?.v ?? null,
      volumeUsd: num(ws[`D${r}`]?.v),
      bidYield: num(ws[`E${r}`]?.v),
      cupomPct: num(ws[`F${r}`]?.v) != null ? ws[`F${r}`].v * 100 : null,
      duration: num(ws[`G${r}`]?.v),
      spreadOverTreasury: num(ws[`H${r}`]?.v),
    });
  }
  return res.json({ asOf, bonds });
}

// Genérico pras três abas de histórico em bloco: blocos de 3 colunas (rótulo | valor | vazio)
// a partir da coluna A, rótulo (nome do papel ou vencimento do treasury) na linha 1, alinhado
// com a coluna de valor (não a de timestamp). Casa por texto exato (trim).
function findBlockSeries(wb, sheetKey, label) {
  const cfg = BLOCK_SHEETS[sheetKey];
  const ws = wb.Sheets[cfg.sheet];
  if (!ws) return null;
  const target = String(label).trim();
  const MAX_BLOCKS = 90; // folga generosa sobre o nº de blocos atual de qualquer uma das abas

  for (let block = 0; block < MAX_BLOCKS; block++) {
    const tsCol = 1 + block * 3;
    const valCol = tsCol + 1;
    const headerLabel = ws[`${colLetter(valCol)}1`]?.v;
    if (headerLabel == null || String(headerLabel).trim() !== target) continue;

    const series = [];
    for (let r = cfg.dataStartRow; r <= cfg.dataStartRow + 1400; r++) {
      const dateCell = ws[`${colLetter(tsCol)}${r}`];
      if (typeof dateCell?.v !== 'number') break; // série é contígua — primeiro timestamp ausente marca o fim
      const valCell = ws[`${colLetter(valCol)}${r}`];
      const val = typeof valCell?.v === 'number' ? valCell.v : null;
      if (val == null) continue;
      series.push({ date: excelSerialToBr(dateCell.v), [cfg.valueField]: val });
    }
    return series;
  }
  return null;
}

// Alguns papéis são o MESMO bond que outro, só cotado por dealer diferente (mesma linha em
// "Controle Duration 2" duplicada, mesmo ISIN — ver comentário em handleSnapshot), mas não têm
// bloco próprio nas abas de histórico. Curado manualmente pelo Daniel um a um (não é regra
// automática por ISIN — nem toda duplicata de ISIN é isso): usa o histórico do papel
// equivalente já existente em vez de "sem histórico".
const HISTORY_NAME_ALIASES = {
  'Rede Dor 30 2': 'Rede Dor 30',
};

function handleHistory(wb, kind, key, res) {
  if (!key) return res.status(400).json({ error: `parâmetro "${kind === 'treasury' ? 'maturity' : 'name'}" obrigatório` });
  const resolvedKey = (kind === 'yield' || kind === 'price') ? (HISTORY_NAME_ALIASES[key] || key) : key;
  const series = findBlockSeries(wb, kind, resolvedKey);
  if (series == null) {
    const sheet = BLOCK_SHEETS[kind].sheet;
    return res.json({ history: [], warning: `não encontrado na aba "${sheet}"` });
  }
  return res.json({ history: series });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const wb = await loadWorkbook();
    const kind = req.query.history;
    if (kind === 'yield' || kind === 'price') return handleHistory(wb, kind, req.query.name, res);
    if (kind === 'treasury') return handleHistory(wb, 'treasury', req.query.maturity, res);
    if (kind != null) return res.status(400).json({ error: 'history deve ser "yield", "price" ou "treasury"' });
    return handleSnapshot(wb, res);
  } catch (e) {
    return res.status(500).json({ error: `Bonds Terminal.xlsx: ${e.message}` });
  }
}
