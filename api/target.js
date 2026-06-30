export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const ticker = req.query.t;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    // Step 1 — get cookie + crumb
    const cookieRes = await fetch('https://fc.yahoo.com', { headers: BASE_HEADERS });
    const cookie = (cookieRes.headers.get('set-cookie') || '').split(';')[0];

    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...BASE_HEADERS, Cookie: cookie },
    });
    const crumb = await crumbRes.text();

    // Step 2 — quoteSummary
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=financialData&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, {
      headers: { ...BASE_HEADERS, Cookie: cookie },
    });
    if (!r.ok) throw new Error(`Yahoo quoteSummary ${r.status}`);
    const d = await r.json();
    const fd = d?.quoteSummary?.result?.[0]?.financialData;
    if (!fd) throw new Error('sem financialData');

    return res.json({
      targetMean:     fd.targetMeanPrice?.raw         ?? null,
      targetHigh:     fd.targetHighPrice?.raw         ?? null,
      targetLow:      fd.targetLowPrice?.raw          ?? null,
      numAnalysts:    fd.numberOfAnalystOpinions?.raw ?? null,
      recommendation: fd.recommendationKey            ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
