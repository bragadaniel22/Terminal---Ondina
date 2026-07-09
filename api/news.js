const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MARKET_TICKERS = ['^GSPC', '^DJI', '^IXIC'];

export async function fetchNewsForTickers(tickers) {
  const results = await Promise.all(tickers.map(t =>
    fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(t)}&newsCount=12&quotesCount=0`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    }).then(r => r.json()).catch(() => ({}))
  ));

  const seen = new Set();
  const items = [];
  for (const r of results) {
    for (const n of (r.news || [])) {
      if (!n.uuid || seen.has(n.uuid)) continue;
      seen.add(n.uuid);
      items.push({
        title: n.title,
        publisher: n.publisher,
        link: n.link,
        time: n.providerPublishTime ?? null,
        thumbnail: n.thumbnail?.resolutions?.[0]?.url ?? null,
      });
    }
  }
  items.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  return items.slice(0, 20);
}

export async function fetchMarketNews() {
  return fetchNewsForTickers(MARKET_TICKERS);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ticker = req.query.t;
    const items = ticker ? await fetchNewsForTickers([ticker]) : await fetchMarketNews();
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
