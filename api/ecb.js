export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const url = 'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?format=jsondata&lastNObservations=1';
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return res.status(r.status).json({ error: `ECB HTTP ${r.status}` });
    const d = await r.json();
    const seriesMap = d?.dataSets?.[0]?.series;
    if (!seriesMap) return res.status(500).json({ error: 'ECB: sem dataSets' });
    const sid = Object.keys(seriesMap)[0];
    if (!sid) return res.status(500).json({ error: 'ECB: sem série' });
    const obs = seriesMap[sid]?.observations;
    if (!obs) return res.status(500).json({ error: 'ECB: sem observações' });
    const key = Object.keys(obs)[0];
    const v = obs[key][0];
    const date = d?.structure?.dimensions?.observation?.[0]?.values?.[parseInt(key)]?.id ?? '—';
    return res.json({ v, date });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
