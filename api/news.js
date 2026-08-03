// Notícias (mercado geral OU por ticker) + resumo por IA sob demanda. Fundido com o antigo
// api/summarize-news.js nessa sessão — o plano Hobby do Vercel limita a 12 Serverless
// Functions por deployment, e esse projeto bateu exatamente nesse teto; consolidar
// endpoints usados juntos (Busca e CNBC chamam os dois) numa função só é a forma de abrir
// espaço sem cortar funcionalidade. Ver METODOLOGIA.md seção 19.1.1.
//
// GET /api/news                                    → notícias do mercado geral (comportamento de sempre)
// GET /api/news?t=TICKER                            → notícias de um ticker (comportamento de sempre)
// GET /api/news?action=summarize&url=...&title=...  → resumo via Gemini (era GET /api/summarize-news)
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
      });
    }
  }
  items.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  return items.slice(0, 20);
}

export async function fetchMarketNews() {
  return fetchNewsForTickers(MARKET_TICKERS);
}

async function handleNewsList(req, res) {
  try {
    const ticker = req.query.t;
    const items = ticker ? await fetchNewsForTickers([ticker]) : await fetchMarketNews();
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── Resumo por IA de uma notícia (ex api/summarize-news.js) ─────────────────────────────────
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function extractArticleText(html) {
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  const ogMatch = noScripts.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || noScripts.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc = ogMatch ? decodeEntities(ogMatch[1]).trim() : '';

  const paragraphs = [...noScripts.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 40);
  const bodyText = paragraphs.join('\n').slice(0, 4000);

  return { ogDesc, bodyText };
}

async function handleSummarize(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no ambiente' });

  const { url, title } = req.query;
  if (!url) return res.status(400).json({ error: 'url obrigatória' });

  try {
    let articleText = '';
    try {
      const pageRes = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const { ogDesc, bodyText } = extractArticleText(html);
        articleText = bodyText.length > 200 ? bodyText : ogDesc;
      }
    } catch { /* segue sem texto extraído */ }

    const prompt = articleText
      ? `Resuma esta notícia em português (Brasil), em 2 a 4 frases, direto e objetivo, focando no que é relevante para o mercado financeiro. Baseie-se apenas no texto abaixo, extraído de uma página pública do Yahoo Finance.\n\nTítulo: "${title || ''}"\n\nTexto disponível:\n${articleText}`
      : `Não foi possível extrair o texto completo desta notícia (pode ser conteúdo restrito ou renderizado via JavaScript). Com base apenas no título abaixo, escreva 1 a 2 frases em português (Brasil) explicando objetivamente o que essa manchete provavelmente significa para o mercado financeiro. Não invente detalhes específicos (números, nomes, datas) que não estão no título — seja genérico onde faltar informação.\n\nTítulo: "${title || ''}"`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    if (!r.ok) {
      if (r.status === 429) {
        return res.status(429).json({ error: 'rate_limit' });
      }
      const t = await r.text();
      throw new Error(`Gemini ${r.status}: ${t.slice(0, 200)}`);
    }
    const data = await r.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const summary = parts.map(p => p.text).filter(Boolean).join('').trim();
    if (!summary) throw new Error('resposta vazia do Gemini');

    return res.json({ summary, basedOnFullText: !!articleText });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.query.action === 'summarize') return handleSummarize(req, res);
  return handleNewsList(req, res);
}
