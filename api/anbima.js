export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const dates = lastBusinessDays(5);
  let lastErr = 'sem dados';

  for (const dt of dates) {
    try {
      const r = await fetch('https://www.anbima.com.br/informacoes/est-termo/CZ-down.asp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.anbima.com.br/informacoes/est-termo/CZ.asp',
          'Origin': 'https://www.anbima.com.br',
        },
        body: new URLSearchParams({ Idioma: 'PT', Dt_Ref: dt, saida: 'csv' }).toString(),
      });

      if (!r.ok) { lastErr = `HTTP ${r.status} (${dt})`; continue; }
      const text = await r.text();
      if (!text || text.length < 100) { lastErr = `resposta vazia (${dt})`; continue; }

      const parsed = parse252(text, dt);
      if (!parsed) { lastErr = `vértice 252 não encontrado (${dt})`; continue; }

      return res.json(parsed);
    } catch (e) {
      lastErr = e.message;
    }
  }

  return res.status(500).json({ error: lastErr });
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

function parse252(text, refDate) {
  // Detecta separador (ponto-e-vírgula ou vírgula)
  const sep = text.includes(';') ? ';' : ',';
  const lines = text.split('\n');

  for (const line of lines) {
    const cols = line.split(sep).map(c => c.trim().replace(/"/g, '').replace(',', '.'));
    // Vértice 252 está na primeira coluna
    if (cols[0] === '252' || cols[0] === '252.0') {
      const ipca = parseFloat(cols[1]);
      const pre  = parseFloat(cols[2]);
      const inf  = parseFloat(cols[3]);
      if (isNaN(ipca) && isNaN(pre)) return null; // linha inválida
      return {
        ettjIpca: isNaN(ipca) ? null : ipca,
        ettjPre:  isNaN(pre)  ? null : pre,
        infImpl:  isNaN(inf)  ? null : inf,
        date: refDate,
      };
    }
  }
  return null;
}
