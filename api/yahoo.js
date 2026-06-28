module.exports = async function handler(req, res) {
  const { t, range = '5d' } = req.query;
  if (!t) return res.status(400).json({ error: 'missing ticker' });

  const ticker = encodeURIComponent(t);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
      },
    });
    const data = await upstream.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message) });
  }
};
