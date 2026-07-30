export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TARGETS = ['20280815', '20290515', '20300815', '20320815', '20350515', '20450515'];
  const requested = parseInt(req.query.days, 10);
  // trava de segurança: cada dia é um arquivo ANBIMA buscado individualmente (não existe
  // endpoint de histórico em lote), então limitamos a janela pra não estourar o timeout
  // da função serverless nem gerar centenas de requisições de uma vez.
  const days = Math.min(isNaN(requested) ? 65 : requested, 130);
  const dates = lastBusinessDays(days);

  const results = await Promise.allSettled(dates.map(async (dt) => {
    const [day, month, year] = dt.split('/');
    const yy = year.slice(-2);
    const filename = `ms${yy}${month}${day}.txt`;
    const url = `https://www.anbima.com.br/informacoes/merc-sec/arqs/${filename}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!r.ok) return null;
    const text = await r.text();
    const rates = {};
    for (const line of text.split('\n')) {
      const cols = line.split('@');
      if (cols[0]?.trim() !== 'NTN-B') continue;
      const mat = cols[4]?.trim();
      if (TARGETS.includes(mat)) {
        const rate = parseFloat(cols[7]?.trim().replace(',', '.'));
        if (!isNaN(rate)) rates[mat.slice(0, 4)] = rate;
      }
    }
    if (!Object.keys(rates).length) return null;
    return { date: dt, rates };
  }));

  const history = results
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean)
    .sort((a, b) => toDate(a.date) - toDate(b.date));

  if (!history.length) return res.status(500).json({ error: 'NTN-B: sem dados disponíveis no período' });
  return res.json({ history });
}

function toDate(dt) {
  const [d, m, y] = dt.split('/');
  return new Date(+y, +m - 1, +d);
}

function lastBusinessDays(n) {
  const days = [];
  const d = new Date();
  while (days.length < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      days.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return days;
}
