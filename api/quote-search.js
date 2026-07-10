const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q obrigatório' });

  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
    const data = await r.json();
    const quotes = (data.quotes || [])
      .filter(item => item.symbol)
      .map(item => ({
        symbol: item.symbol,
        name: item.shortname || item.longname || item.symbol,
        exchange: item.exchDisp || item.exchange || '',
        type: item.quoteType || '',
      }));
    return res.json({ quotes });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
