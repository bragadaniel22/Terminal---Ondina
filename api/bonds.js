// Preço + analytics (yield, duration, G-spread) de bonds via API oficial autenticada
// do bondterminal.com (v1, com API key — bem mais completa que o endpoint público que
// usávamos antes). Buscamos todos os ISINs da carteira. SEMPRE devolvemos os 16 ISINs
// da carteira nessa resposta (metadados region/label/isin não dependem da fonte) —
// quando a fonte não retorna preço pra um bond, ele vem com `available: false` e sem os
// campos de preço/analytics, em vez de ser descartado. O front-end decide o que fazer
// (cai pro último dado em cache local) — ver `loadBonds()` em index.html.
const BONDS = [
  { region: 'Brasil', label: 'Eletrobrás 30', isin: 'USP22835AB13' },
  { region: 'Brasil', label: 'Rede Dor 30', isin: 'USL7915TAA09' },
  { region: 'Brasil', label: 'Aegea 31', isin: 'USL01343AB52' },
  { region: 'Brasil', label: 'Banco do Brasil 31', isin: 'USP2000TAE57' },
  { region: 'Brasil', label: 'B3 31', isin: 'USP19118AA91' },
  { region: 'Brasil', label: 'LD Celulose 32', isin: 'USA4S42PAA32' },
  { region: 'Brasil', label: 'Suzano 31', isin: 'US86964WAJ18' },
  { region: 'Brasil', label: 'Brasil 31', isin: 'US105756CE88' },
  { region: 'Brasil', label: 'Bradesco 30', isin: 'US05947LBB36' },
  { region: 'Brasil', label: 'Usiminas 32', isin: 'USL95806AB88' },
  { region: 'Brasil', label: 'BTG 31', isin: 'US05971BAM19' },
  { region: 'África/Ásia/Latam', label: 'Cemex 30', isin: 'USP2253TJQ33' },
  { region: 'África/Ásia/Latam', label: 'Codelco 34', isin: 'USP3143NBQ62' },
  { region: 'África/Ásia/Latam', label: 'GCC 32', isin: 'USP47465AB82' },
  { region: 'África/Ásia/Latam', label: 'Cemex Perp', isin: 'USP2253TJW01' },
  { region: 'África/Ásia/Latam', label: 'BBVA México', isin: 'USP2000GAA15' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// A API do bondterminal.com limita a 4 requisições simultâneas por chave — disparar as
// 16 de uma vez (como fazíamos antes) estourava esse limite na cara e devolvia 429 pra
// praticamente tudo. `MAX_CONCURRENCY` abaixo do limite real (com margem) garante que
// nunca temos mais que isso em voo ao mesmo tempo.
const MAX_CONCURRENCY = 3;

// Cache em memória do processo (module-scope) — sobrevive entre invocações enquanto a
// instância da função serverless continuar "quente" (Vercel reaproveita a mesma instância
// por alguns minutos entre requisições). TTL curto só pra evitar bater na API de novo a
// cada F5 rápido ou dentro da janela do auto-refresh — não é uma garantia de cache global
// (cada instância/região tem a sua), mas reduz bastante o consumo de cota diária.
const memCache = new Map(); // isin -> { data, reason, at }
const MEM_CACHE_TTL_MS = 3 * 60 * 1000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Roda `mapper` sobre `items` com no máximo `concurrency` execuções simultâneas.
async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// A fonte pode falhar num blip passageiro pro mesmo bond — tenta de novo antes de
// considerar realmente indisponível. Exceção: `quota_exceeded` é um limite DIÁRIO — repetir
// não adianta nada e só desperdiça mais cota, então nesse caso desiste na primeira tentativa.
async function fetchAnalytics(isin, apiKey, attempts = 3) {
  let lastReason = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`https://bondterminal.com/api/v1/bonds/${encodeURIComponent(isin)}/analytics`, {
        headers: { 'User-Agent': UA, 'Authorization': `Bearer ${apiKey}` },
      });
      if (r.status === 404) return { data: null, reason: '404 (sem cobertura pra esse ISIN)' };
      if (r.ok) {
        const d = await r.json();
        if (d.price != null) return { data: d, reason: null };
        lastReason = 'HTTP 200 sem price no payload';
      } else {
        const body = await r.text().catch(() => '');
        lastReason = `HTTP ${r.status}${body ? ': ' + body.slice(0, 150) : ''}`;
        if (r.status === 429 && body.includes('quota_exceeded')) {
          return { data: null, reason: 'cota diária do bondterminal.com esgotada' };
        }
      }
    } catch (e) {
      lastReason = `exceção: ${e.message}`;
    }
    if (i < attempts - 1) await sleep(700 + i * 500);
  }
  return { data: null, reason: lastReason };
}

async function fetchAnalyticsCached(isin, apiKey) {
  const cached = memCache.get(isin);
  if (cached && Date.now() - cached.at < MEM_CACHE_TTL_MS) return cached;
  const result = await fetchAnalytics(isin, apiKey);
  memCache.set(isin, { ...result, at: Date.now() });
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.BONDS_API_KEY;
  if (!apiKey) {
    // Sem a chave configurada, ainda devolvemos o esqueleto completo da carteira
    // (region/label/isin) pra o front-end poder cair pro cache local em vez de
    // simplesmente não ter nenhum ISIN pra mostrar.
    return res.json({
      bonds: BONDS.map((b) => ({ ...b, available: false })),
      totalRequested: BONDS.length,
      totalAvailable: 0,
      error: 'BONDS_API_KEY não configurada',
    });
  }

  const bonds = await pMap(BONDS, async (b) => {
    const { data: d, reason } = await fetchAnalyticsCached(b.isin, apiKey);
    if (!d) return { ...b, available: false, reason };
    return {
      ...b,
      available: true,
      price: d.price,
      priceDate: d.market?.timestamp || null,
      changePercent: d.market?.change?.percent1D ?? null,
      ytw: d.yields?.ytw ?? null,
      duration: d.risk?.modifiedDuration ?? null,
      gSpread: d.spreads?.gSpread ?? null,
      analytics: d, // guardado inteiro pro popup de Key Metrics (nenhuma chamada extra)
    };
  }, MAX_CONCURRENCY);

  const totalAvailable = bonds.filter((b) => b.available).length;

  return res.json({ bonds, totalRequested: BONDS.length, totalAvailable });
}
