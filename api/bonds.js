// Lê "Bonds Terminal/Bonds Terminal.xlsx" (raiz do repo) — quatro abas usadas hoje:
// - "Controle Duration": foto do dia por papel (nome, ISIN, banco/dealer, volume, bid yield,
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
// GET /api/bonds                              → snapshot (lista de papéis de "Controle Duration")
// GET /api/bonds?history=yield&name=...       → histórico de Bid Yield ("Bid Yield")
// GET /api/bonds?history=price&name=...       → histórico de preço/PU ("Preços")
// GET /api/bonds?history=treasury&maturity=2Y → histórico de yield do treasury ("Treasury")
//
// Cada linha de "Controle Duration" é tratada como uma entrada própria — não agrupamos por
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

function excelDateToBr(v) {
  if (v instanceof Date) {
    return `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}`;
  }
  if (v == null) return null;
  return String(v).trim();
}

async function loadWorkbook() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const XLSX = await import('xlsx');
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Bonds Terminal', 'Bonds Terminal.xlsx');
  return XLSX.read(readFileSync(filePath), { type: 'buffer', cellDates: true });
}

// "Controle Duration": Bonds=D, Isin=E, Banco=F, Volume=G, Bid Yield=H, Cupom=I, Duration=J,
// (K vazia), Spread Over Treasury=L. Cupom vem como fração (0,0503 = 5,03%); os demais campos
// numéricos já vêm na unidade certa.
function handleSnapshot(wb, res) {
  const ws = wb.Sheets['Controle Duration'];
  if (!ws) return res.status(500).json({ error: 'Bonds Terminal.xlsx: aba "Controle Duration" não encontrada' });

  const bonds = [];
  for (let r = 3; r <= 186; r++) {
    const name = ws[`D${r}`]?.v;
    const isin = ws[`E${r}`]?.v;
    if (!name || !isin) continue;
    const num = (cellVal) => (typeof cellVal === 'number' ? cellVal : null);
    bonds.push({
      name: String(name).trim(),
      isin: String(isin).trim(),
      banco: ws[`F${r}`]?.v ?? null,
      volumeUsd: num(ws[`G${r}`]?.v),
      bidYield: num(ws[`H${r}`]?.v),
      cupomPct: num(ws[`I${r}`]?.v) != null ? ws[`I${r}`].v * 100 : null,
      duration: num(ws[`J${r}`]?.v),
      spreadOverTreasury: num(ws[`L${r}`]?.v),
    });
  }
  return res.json({ bonds });
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
      if (!dateCell?.v) break; // série é contígua — primeira linha vazia marca o fim
      const valCell = ws[`${colLetter(valCol)}${r}`];
      const val = typeof valCell?.v === 'number' ? valCell.v : null;
      if (val == null) continue;
      series.push({ date: excelDateToBr(dateCell.v), [cfg.valueField]: val });
    }
    return series;
  }
  return null;
}

function handleHistory(wb, kind, key, res) {
  if (!key) return res.status(400).json({ error: `parâmetro "${kind === 'treasury' ? 'maturity' : 'name'}" obrigatório` });
  const series = findBlockSeries(wb, kind, key);
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
