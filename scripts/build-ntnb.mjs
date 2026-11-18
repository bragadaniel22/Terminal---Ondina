// Converte a "Taxas Antigas NTNB.xlsx" num data/ntnb-historico.json enxuto.
//
// A partir daqui o JSON é a FONTE DE VERDADE do histórico de NTN-B, e a planilha passa a ser
// só o arquivo histórico congelado. Motivo: o XLSX.writeFile do salvar-mes.mjs inflava o
// xl/theme/theme1.xml ~32x a cada gravação semanal — a cópia local chegou a 960 MB com apenas
// 1.155 células de dado real, e nesse tamanho o arquivo nem podia mais ser publicado (o GitHub
// recusa acima de 100 MB). Tirando o código de cima do .xlsx, a causa raiz desaparece.
//
// A estrutura das abas da planilha (blocos de 2 colunas por dia, com a data em serial do Excel
// numa das 4 primeiras linhas) está documentada em api/ntnb.js — este script replica aquela
// leitura e nada mais; a mesma saída, só que num formato estável.
//
// Rodar no build: node scripts/build-ntnb.mjs
// Sem a planilha, sai em silêncio: api/ntnb.js tem fallback e continua lendo o .xlsx direto.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_PATH = path.join(RAIZ, 'Taxas Antigas NTNB.xlsx');
const SAIDA_DIR = path.join(RAIZ, 'data');
const SAIDA = path.join(SAIDA_DIR, 'ntnb-historico.json');

if (!existsSync(XLSX_PATH)) {
  console.log('build-ntnb: planilha não encontrada — pulando (api/ntnb.js lê o .xlsx direto).');
  process.exit(0);
}

const XLSX = await import('xlsx');

// Serial do Excel → "dd/mm/aaaa". Mesma conversão de api/ntnb.js.
function excelSerialToBr(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}
const toDate = (br) => { const [d, m, y] = br.split('/').map(Number); return new Date(y, m - 1, d); };

const colLetter = (n) => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

// Espelho de parseYearSheet em api/ntnb.js — a distância entre blocos NÃO é fixa, por isso a
// descoberta varre colunas procurando um serial de data plausível em vez de usar um passo fixo.
function parseYearSheet(ws) {
  const snapshots = [];
  if (!ws) return snapshots;
  const MAX_COLS = 600;
  for (let c = 1; c <= MAX_COLS; c++) {
    const col = colLetter(c);
    for (let r = 1; r <= 4; r++) {
      const cell = ws[`${col}${r}`];
      if (typeof cell?.v !== 'number' || cell.v <= 40000 || cell.v >= 60000) continue;
      const rates = {};
      for (let rr = r + 1; rr <= r + 8; rr++) {
        const label = ws[`${col}${rr}`]?.v;
        const val = ws[`${colLetter(c + 1)}${rr}`]?.v;
        if (label != null && typeof val === 'number') {
          const year = String(label).replace(/\D/g, '');
          if (year.length === 4) rates[year] = Math.round(val * 100 * 10000) / 10000; // 0,0803 → 8,03
        }
      }
      if (Object.keys(rates).length) snapshots.push({ date: excelSerialToBr(cell.v), rates });
      break;
    }
  }
  return snapshots;
}

const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer' });

const snapshots = wb.SheetNames
  .filter((n) => /^\d{4}$/.test(n))
  .flatMap((n) => parseYearSheet(wb.Sheets[n]))
  .sort((a, b) => toDate(a.date) - toDate(b.date));

// Aba manual "Mês Anterior" — só entra como reserva quando as abas de ano não têm ponto no mês.
let mesAnterior = null;
const ws = wb.Sheets['Mês Anterior'];
if (ws && typeof ws['C2']?.v === 'number') {
  const rates = {};
  for (let row = 5; row <= 10; row++) {
    const label = ws[`C${row}`]?.v;
    const val = ws[`D${row}`]?.v;
    if (label != null && typeof val === 'number') {
      const year = String(label).replace(/\D/g, '');
      if (year) rates[year] = Math.round(val * 100 * 10000) / 10000;
    }
  }
  if (Object.keys(rates).length) mesAnterior = { date: excelSerialToBr(ws['C2'].v), rates };
}

if (!existsSync(SAIDA_DIR)) mkdirSync(SAIDA_DIR, { recursive: true });
writeFileSync(SAIDA, JSON.stringify({
  gerado: new Date().toISOString(),
  origem: 'Taxas Antigas NTNB.xlsx',
  mesAnterior,
  snapshots,
}, null, 1));

const kb = (statSync(SAIDA).size / 1024).toFixed(1);
console.log(`build-ntnb: ${snapshots.length} snapshots (${snapshots[0]?.date} → ${snapshots[snapshots.length - 1]?.date})`);
console.log(`build-ntnb: mês anterior = ${mesAnterior ? mesAnterior.date : '(nenhum)'}`);
console.log(`build-ntnb: data/ntnb-historico.json (${kb} KB)`);
