// Histórico diário do DI Futuro via scraping da página pública do ADVFN — a B3 não expõe
// histórico via API pública gratuita (só cotação atual, ver api/b3.js). A página de histórico
// do ADVFN já traz uma tabela pronta embutida no HTML (até ~64 pregões, aproximadamente os
// últimos 3 meses) codificada em base64 dentro do atributo `data-options` de uma <div
// id="table_more_historical">, então basta UM request (sem precisar buscar dia a dia como
// fazemos com a ANBIMA pro NTN-B — ver api/ntnb-history.js).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function extractHistoricalRows(html) {
  const m = html.match(/id="table_more_historical"[^>]*data-options="([^"]+)"/);
  if (!m) return null;
  const json = Buffer.from(m[1], 'base64').toString('utf-8');
  const parsed = JSON.parse(json);
  return Array.isArray(parsed.data) ? parsed.data : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const symbol = req.query.symbol;
  if (!symbol || !/^DI1F\d{2}$/.test(symbol)) {
    return res.status(400).json({ error: 'symbol inválido (esperado ex: DI1F30)' });
  }

  try {
    const r = await fetch(`https://br.advfn.com/bolsa-de-valores/bmf/${symbol}/historico`, {
      headers: { 'User-Agent': UA },
    });
    if (!r.ok) return res.status(502).json({ error: `ADVFN: HTTP ${r.status}` });
    const html = await r.text();

    const rows = extractHistoricalRows(html);
    if (!rows || !rows.length) return res.status(502).json({ error: 'ADVFN: tabela histórica não encontrada (layout da página pode ter mudado)' });

    const history = rows
      .map((row) => ({ date: Number(row.Date), value: row.ClosePrice }))
      .filter((h) => Number.isFinite(h.date) && h.value != null)
      .sort((a, b) => a.date - b.date);

    return res.json({ history, source: 'advfn' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
