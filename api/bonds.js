// Preço + analytics (yield, duration, G-spread) de bonds via API oficial autenticada
// do bondterminal.com (v1, com API key — bem mais completa que o endpoint público que
// usávamos antes). Buscamos todos os ISINs da carteira em paralelo e devolvemos só os
// que a fonte realmente cobre — o resto é descartado silenciosamente.
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// A fonte pode falhar num blip passageiro pro mesmo bond — tenta de novo antes de
// considerar realmente indisponível (mesmo comportamento que já tínhamos).
async function fetchAnalytics(isin, apiKey, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`https://bondterminal.com/api/v1/bonds/${encodeURIComponent(isin)}/analytics`, {
        headers: { 'User-Agent': UA, 'Authorization': `Bearer ${apiKey}` },
      });
      if (r.status === 404) return null; // bond não coberto por essa fonte — não adianta repetir
      if (r.ok) {
        const d = await r.json();
        if (d.price != null) return d;
      }
    } catch (_) {}
    if (i < attempts - 1) await sleep(500 + i * 300);
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.BONDS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'BONDS_API_KEY não configurada' });

  const results = await Promise.allSettled(BONDS.map(async (b) => {
    const d = await fetchAnalytics(b.isin, apiKey);
    if (!d) return null;
    return {
      ...b,
      price: d.price,
      priceDate: d.market?.timestamp || null,
      changePercent: d.market?.change?.percent1D ?? null,
      ytw: d.yields?.ytw ?? null,
      duration: d.risk?.modifiedDuration ?? null,
      gSpread: d.spreads?.gSpread ?? null,
      analytics: d, // guardado inteiro pro popup de Key Metrics (nenhuma chamada extra)
    };
  }));

  const bonds = results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);

  return res.json({ bonds, totalRequested: BONDS.length, totalAvailable: bonds.length });
}
