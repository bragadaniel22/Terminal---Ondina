export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const symbol = req.query.s || 'DI1F30';
  const url = `https://cotacao.b3.com.br/mds/api/v1/InstrumentQuotation/${encodeURIComponent(symbol)}`;

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    const data = await r.json();
    if (data.BizSts?.cd !== 'OK' || !data.Trad?.length) {
      return res.status(500).json({ error: 'B3: sem negócios' });
    }
    const qtn = data.Trad[0].scty.SctyQtn;
    return res.json({
      price: qtn.curPrc,
      open: qtn.opngPric,
      date: data.Msg?.dtTm ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
