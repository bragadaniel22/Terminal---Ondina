// Preço de bonds via API interna (não-oficial, pode mudar) do bondterminal.com.
// Buscamos todos os ISINs da carteira em paralelo e devolvemos só os que têm preço —
// o resto é descartado silenciosamente porque simplesmente não existem nessa fonte.
const BONDS = [
  { region: 'Brasil', label: 'Banco do Brasil 26', isin: 'USP2000TAA36' },
  { region: 'Brasil', label: 'Eletrobrás 30', isin: 'USP22835AB13' },
  { region: 'Brasil', label: 'Rede Dor 30', isin: 'USL7915TAA09' },
  { region: 'Brasil', label: 'Klabin 31', isin: 'USA35155AE99' },
  { region: 'Brasil', label: 'Aegea 31', isin: 'USL01343AB52' },
  { region: 'Brasil', label: 'BTG 29', isin: 'US05971BAK52' },
  { region: 'Brasil', label: 'XP 29', isin: 'US98379XAB01' },
  { region: 'Brasil', label: 'Banco do Brasil 31', isin: 'USP2000TAE57' },
  { region: 'Brasil', label: 'B3 31', isin: 'USP19118AA91' },
  { region: 'Brasil', label: 'LD Celulose 32', isin: 'USA4S42PAA32' },
  { region: 'Brasil', label: 'Suzano 31', isin: 'US86964WAJ18' },
  { region: 'Brasil', label: 'Brasil 31', isin: 'US105756CE88' },
  { region: 'Brasil', label: 'Bradesco 30', isin: 'US05947LBB36' },
  { region: 'Brasil', label: 'Usiminas 32', isin: 'USL95806AB88' },
  { region: 'Brasil', label: 'Caixa 30', isin: 'US12804DAA28' },
  { region: 'Brasil', label: 'BTG 31', isin: 'US05971BAM19' },
  { region: 'Europa', label: 'Société Générale', isin: 'USF43628C650' },
  { region: 'Europa', label: 'Bayer 28', isin: 'USU07265AF50' },
  { region: 'Europa', label: 'BNP 29', isin: 'US09659X2R20' },
  { region: 'Europa', label: 'Barclays 28', isin: 'US06738EAU91' },
  { region: 'Europa', label: 'Barclays 33', isin: 'US06738ECE32' },
  { region: 'Europa', label: 'Deutsche Bank 34', isin: 'US251526CT41' },
  { region: 'Europa', label: 'Santander 33', isin: 'US05964HAV78' },
  { region: 'US Consolidado', label: 'JP Morgan', isin: 'US06423AAJ25' },
  { region: 'US Consolidado', label: 'Citigroup', isin: 'US172967NU15' },
  { region: 'US Consolidado', label: 'HCA 29', isin: 'US404119BX69' },
  { region: 'US Consolidado', label: 'JP Morgan 33', isin: 'US46647PDK93' },
  { region: 'US Consolidado', label: 'Nextera 2079', isin: 'US65339KBK51' },
  { region: 'US Consolidado', label: 'Morgan Stanley 36', isin: 'US61747YEF88' },
  { region: 'US Consolidado', label: 'Amex 34', isin: 'US025816DK20' },
  { region: 'Preferred', label: 'Goldman Sachs', isin: 'US38141GA385' },
  { region: 'Preferred', label: 'Citi Group Pref', isin: 'US172967PC98' },
  { region: 'Preferred', label: 'Goldman Sachs Pref', isin: 'US38141GC282' },
  { region: 'Preferred', label: 'JPMorgan Pref', isin: 'US48128AAJ25' },
  { region: 'Preferred', label: 'Citi Group Pref 2', isin: 'US172967PJ42' },
  { region: 'Preferred', label: 'Bank of America Perp', isin: 'US06055HAH66' },
  { region: 'África/Ásia/Latam', label: 'Hyundai', isin: 'US44891CBL63' },
  { region: 'África/Ásia/Latam', label: 'Cemex 30', isin: 'USP2253TJQ33' },
  { region: 'África/Ásia/Latam', label: 'Hyundai 2', isin: 'US44891CCE12' },
  { region: 'África/Ásia/Latam', label: 'Codelco 34', isin: 'USP3143NBQ62' },
  { region: 'África/Ásia/Latam', label: 'GCC 32', isin: 'USP47465AB82' },
  { region: 'África/Ásia/Latam', label: 'Cemex Perp', isin: 'USP2253TJW01' },
  { region: 'África/Ásia/Latam', label: 'BBVA México', isin: 'USP2000GAA15' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const results = await Promise.allSettled(BONDS.map(async (b) => {
    const r = await fetch(`https://bondterminal.com/api/bonds/live-price/${encodeURIComponent(b.isin)}`, {
      headers: { 'User-Agent': UA },
    });
    const d = await r.json();
    if (d.price == null || d.priceSource === 'unavailable') return null;
    return {
      ...b,
      price: d.price,
      priceSource: d.priceSource, // 'live' | 'historical' — nunca chamamos histórico de "negociado agora"
      priceDate: d.historicalPriceDate || null,
      changePercent: d.changePercent ?? d.changes?.percent1D ?? null,
    };
  }));

  const bonds = results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);

  return res.json({ bonds, totalRequested: BONDS.length, totalAvailable: bonds.length });
}
