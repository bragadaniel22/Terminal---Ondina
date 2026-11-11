// Converte a "Bonds Terminal.xlsx" num JSON enxuto, em tempo de BUILD.
//
// Motivo: ler o xlsx de 4,1 MB custa ~2,5s de CPU, e XLSX.read é síncrono — num servidor
// single-thread como o Node isso trava TODAS as outras chamadas do terminal enquanto roda.
// Num plano com fatia de CPU (ex.: 0.1 CPU no Render Free), esses 2,5s viravam ~25 segundos
// na primeira abertura da aba Bonds depois de cada hibernação.
//
// Medido: XLSX.read 2535ms  ->  JSON.parse ~125ms (47-110ms de CPU). ~20x mais rápido.
//
// O JSON sai no formato { "<aba>": { "A1": { "v": <valor> } } } — exatamente o que os
// handlers de api/bonds.js já acessam (wb.Sheets[nome] e ws[ref]?.v), então nenhuma linha da
// lógica de leitura precisou mudar. Guardamos só o valor: formatos, estilos e fórmulas vão
// fora (o código nunca os usa, e foram eles que inflaram o custo do parse).
//
// Rodar no build: node scripts/build-bonds.mjs
// Se a planilha não existir, sai com sucesso sem gerar nada — api/bonds.js tem fallback para
// ler o xlsx direto, então o terminal continua funcionando sem este passo.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_PATH = path.join(RAIZ, 'Bonds Terminal.xlsx');
const SAIDA_DIR = path.join(RAIZ, 'data');
const SAIDA = path.join(SAIDA_DIR, 'bonds.json');

// As quatro abas que api/bonds.js lê. Qualquer aba nova usada lá precisa entrar aqui também,
// senão o handler não a encontra no JSON (e cai no fallback do xlsx, só mais lento).
const ABAS = ['Controle Duration 2', 'Bid Yield', 'Preços', 'Treasury'];

if (!existsSync(XLSX_PATH)) {
  console.log('build-bonds: "Bonds Terminal.xlsx" não encontrada — pulando (api/bonds.js lê o xlsx direto).');
  process.exit(0);
}

const XLSX = await import('xlsx');

const t0 = Date.now();
const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer' });
const lido = Date.now() - t0;

const saida = {};
let total = 0;
for (const nome of ABAS) {
  const ws = wb.Sheets[nome];
  if (!ws) { console.log(`build-bonds: aviso — aba "${nome}" não existe na planilha.`); continue; }
  const celulas = {};
  for (const ref of Object.keys(ws)) {
    if (ref[0] === '!') continue; // !ref, !margins etc. — metadados que o código não usa
    const v = ws[ref].v;
    if (v !== undefined) celulas[ref] = { v };
  }
  saida[nome] = celulas;
  total += Object.keys(celulas).length;
  console.log(`build-bonds: ${nome} — ${Object.keys(celulas).length} células`);
}

if (!existsSync(SAIDA_DIR)) mkdirSync(SAIDA_DIR, { recursive: true });
writeFileSync(SAIDA, JSON.stringify(saida));

const mb = (statSync(SAIDA).size / 1048576).toFixed(2);
console.log(`build-bonds: ${total} células em data/bonds.json (${mb} MB) — xlsx lido em ${lido}ms.`);
