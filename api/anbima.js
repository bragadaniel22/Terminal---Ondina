export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // ?dates=DD/MM/YYYY,DD/MM/YYYY,... → usado pelo relatório de Fechamento (aba ÍNDICES) pra
  // buscar a ETTJ Pré em datas de referência específicas (dia anterior, MTD, YTD). Cada data
  // pedida anda pra trás em dias úteis até achar um arquivo publicado (cobre feriado) ou esgotar
  // as tentativas — nesse caso devolve null naquela posição (o front-end mostra "n/d"). A ANBIMA
  // só retém ~5-6 meses de arquivo diário nesse endpoint, então datas mais antigas que isso
  // sempre voltam null (ex: a base de YTD em janeiro deixa de existir por volta de junho).
  if (req.query.dates) {
    const requested = String(req.query.dates).split(',').map(s => s.trim()).filter(Boolean);
    const results = await Promise.all(requested.map(dt => fetchEttjNear(dt)));
    return res.json({ results });
  }

  const dates = lastBusinessDays(5);
  for (const dt of dates) {
    const parsed = await fetchOneDay(dt);
    if (parsed) return res.json(parsed);
  }
  return res.status(500).json({ error: 'ANBIMA: sem dados' });
}

// maxTries=3 (não 8): cada tentativa tem timeout de 3s, e o Vercel Hobby corta a função em
// ~10s — 3 tentativas sequenciais de 3s é o teto seguro por invocação. Isso reduz a cobertura
// de feriados longos (ex: só cobre um feriado + fim de semana, não um Carnaval de 4 dias), mas
// evitar timeout da função é mais importante que cobrir o caso raro — o front-end já degrada
// pra "n/d" com segurança quando esgota as tentativas.
async function fetchEttjNear(dateStr, maxTries = 3) {
  const anchor = parseBrDate(dateStr);
  if (!anchor) return null;
  const candidates = businessDaysBackFrom(anchor, maxTries);
  for (const dt of candidates) {
    const parsed = await fetchOneDay(dt);
    if (parsed) return parsed;
  }
  return null;
}

async function fetchOneDay(dt) {
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
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text || text.length < 100) return null;
    return parse252(text, dt);
  } catch {
    return null;
  }
}

function parseBrDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function businessDaysBackFrom(startDate, n) {
  const days = [];
  const d = new Date(startDate);
  while (days.length < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      days.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return days;
}

function lastBusinessDays(n) {
  return businessDaysBackFrom(new Date(), n);
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
