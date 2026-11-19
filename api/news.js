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

// Palavras genéricas demais pra servir de filtro — "Inc", "Corporation" e afins aparecem em
// metade das manchetes do mercado e deixariam passar qualquer coisa.
const PALAVRAS_VAZIAS = new Set([
  'inc', 'corp', 'corporation', 'company', 'co', 'ltd', 'limited', 'plc', 'sa', 'ag', 'nv',
  'group', 'holdings', 'holding', 'the', 'and', 'class', 'common', 'stock', 'shares',
]);

// Termos que identificam a empresa numa manchete: o ticker (sem sufixo de bolsa, ex. PETR4.SA
// → PETR4) e as palavras úteis do nome.
function termosDaEmpresa(ticker, nome) {
  const termos = [];
  if (ticker) {
    const base = String(ticker).replace(/\^/g, '').split('.')[0].trim();
    if (base.length >= 2) termos.push(base.toLowerCase());
  }
  for (const w of String(nome || '').split(/[^\p{L}\p{N}]+/u)) {
    const t = w.toLowerCase();
    if (t.length >= 3 && !PALAVRAS_VAZIAS.has(t)) termos.push(t);
  }
  return [...new Set(termos)];
}

async function buscarNoYahoo(q) {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=20&quotesCount=0`,
      { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    return await r.json();
  } catch {
    return {};
  }
}

// `consultas` são os textos mandados ao Yahoo; `termos`, quando presente, filtra o resultado.
// O Yahoo devolve o que acha parecido, sem garantir que a manchete seja sobre a empresa — numa
// busca por NKE vinham notícias de McDonald's. Com os termos, só passa o que cita a empresa no
// título. Sem termos (o feed geral de mercado), o comportamento antigo é mantido.
export async function fetchNewsForTickers(consultas, termos = null, tickersAlvo = null) {
  const results = await Promise.all(consultas.map(buscarNoYahoo));

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
        // O Yahoo marca cada matéria com os tickers que ela cita — inclusive quando o nome não
        // aparece no título. É o que permite saber que "Dow drops 800 points" fala da Nvidia
        // sem precisar baixar e varrer o texto do artigo.
        tickers: Array.isArray(n.relatedTickers) ? n.relatedTickers : [],
      });
    }
  }

  let saida = items;
  if (termos?.length || tickersAlvo?.length) {
    // Duas formas de dizer que a matéria é sobre a empresa:
    // 1. relatedTickers do Yahoo — pega a citação DENTRO do texto, não só no título. É o sinal
    //    mais forte, e sai de graça na mesma resposta.
    // 2. o nome/ticker no título — cobre quando o Yahoo não marcou a relação.
    const alvo = new Set((tickersAlvo || []).map((x) => x.toUpperCase()));
    const casa = (it) => {
      if (alvo.size && (it.tickers || []).some((x) => alvo.has(String(x).toUpperCase()))) return true;
      const t = String(it.title || '').toLowerCase();
      // \b não funciona para acento; a fronteira é verificada com classes explícitas.
      return (termos || []).some((termo) => new RegExp(`(^|[^\\p{L}\\p{N}])${termo}([^\\p{L}\\p{N}]|$)`, 'u').test(t));
    };
    const relevantes = saida.filter(casa);
    // Se o filtro zerar tudo (empresa de nome incomum, manchete que só cita o setor), é melhor
    // devolver o que veio do que uma lista vazia — com os relevantes na frente.
    saida = relevantes.length ? relevantes : saida;
  }

  saida.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  return saida.slice(0, 20);
}

export async function fetchMarketNews() {
  return fetchNewsForTickers(MARKET_TICKERS);
}

async function handleNewsList(req, res) {
  try {
    const ticker = req.query.t;
    const nome = req.query.n; // nome da empresa, quando a ficha souber — melhora muito o filtro
    if (!ticker) return res.json({ items: await fetchMarketNews() });

    // Pergunta pelo ticker E pelo nome: a busca do Yahoo por "NKE" e por "Nike" traz conjuntos
    // bem diferentes, e o que interessa é a união das duas.
    // Quais textos mandar ao Yahoo. Testado ao vivo: a busca dele é sensível ao formato —
    // "PETR4.SA" e "PETR4" devolvem ZERO notícias, e o nome formal "Petróleo Brasileiro"
    // também, mas "Petrobras" devolve 20. Por isso mandamos o ticker E cada palavra
    // significativa do nome separadamente, em vez do nome formal inteiro.
    const termos = termosDaEmpresa(ticker, nome);
    const consultas = [...new Set([ticker, ...termos.slice(0, 3)])];
    // Variações do ticker pra casar com o relatedTickers do Yahoo, que usa o símbolo cru:
    // uma notícia de PETR4.SA vem marcada como "PETR4.SA" ou pelo ADR; aceitar as duas formas
    // (com e sem sufixo de bolsa) evita perder matéria por detalhe de formatação.
    const tickersAlvo = [...new Set([ticker, String(ticker).split('.')[0]].filter(Boolean))];
    const items = await fetchNewsForTickers(consultas, termos, tickersAlvo);
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
  // Notícias por ticker mudam devagar; o resumo de IA de um mesmo artigo é sempre o mesmo —
  // cachear evita reinvocar (e, no caso do resumo, regastar cota do Gemini) quando o mesmo
  // item é reaberto.
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');

  if (req.query.action === 'summarize') return handleSummarize(req, res);
  return handleNewsList(req, res);
}
