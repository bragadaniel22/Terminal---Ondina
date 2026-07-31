// Agrega manchetes da CNBC via RSS oficial (sem scraping do artigo completo — só os
// metadados que o próprio feed disponibiliza: título, link, descrição e data). Cada feed
// é buscado em paralelo; falha em um feed não derruba os outros (Promise.allSettled).
const FEEDS = [
  { id: '100003114', label: 'Top News' },
  { id: '100727362', label: 'World' },
  { id: '15839069',  label: 'Markets' },
  { id: '19854910',  label: 'Technology' },
  { id: '10000664',  label: 'Finance' },
  { id: '20910258',  label: 'Economy' },
  { id: '19836768',  label: 'Energy' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Lê só os primeiros `maxBytes` da página do artigo (a tag og:image sempre fica no
// <head>, bem no início do HTML) e cancela o download assim que encontra — evita baixar
// a página inteira (que pode ter centenas de KB) só pra pegar uma URL de imagem.
async function fetchOgImage(url, maxBytes = 65536, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let text = '', received = 0;
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      text += decoder.decode(value, { stream: true });
      const m = text.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
        || text.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
      if (m) { reader.cancel().catch(() => {}); return decodeHtmlEntities(m[1]); }
    }
    reader.cancel().catch(() => {});
    return null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const [feedResults, topStory] = await Promise.all([
    Promise.allSettled(FEEDS.map(async (feed) => {
      const url = `https://www.cnbc.com/id/${feed.id}/device/rss/rss.html`;
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`${feed.label}: HTTP ${r.status}`);
      const xml = await r.text();
      return { feed, items: parseRssItems(xml, feed.label) };
    })),
    scrapeTopStory(),
  ]);

  const seen = new Set();
  const items = [];
  const errors = [];
  feedResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      r.value.items.forEach((it) => {
        if (seen.has(it.link)) return; // dedupe entre feeds (ex: mesma matéria no Top News e no Markets)
        seen.add(it.link);
        items.push(it);
      });
    } else {
      errors.push(`${FEEDS[i].label}: ${r.reason?.message || 'erro'}`);
    }
  });

  if (!items.length) {
    return res.status(500).json({ error: errors.join(' · ') || 'CNBC: sem dados disponíveis' });
  }

  // As matérias do pacote de destaque quase sempre também aparecem no RSS de Top News —
  // remove da lista comum pra não duplicar (a matéria já aparece no card de destaque).
  if (topStory) {
    const highlighted = new Set([topStory.hero.link, ...topStory.secondary.map(s => s.link)]);
    for (let i = items.length - 1; i >= 0; i--) {
      if (highlighted.has(items[i].link)) items.splice(i, 1);
    }
  }

  items.sort((a, b) => b.time - a.time);

  // Últimas 24h — sem cortar por quantidade de itens. Importante: cada feed RSS da CNBC
  // só disponibiliza os ~30 itens mais recentes (não existe paginação nesse endpoint
  // público). Em categorias de volume muito alto (ex: Top News) isso pode cobrir bem
  // menos que 24h de fato — não é um corte nosso, é o que a CNBC expõe nesse feed.
  // Reportamos a cobertura real por categoria (`coverage`) pra deixar isso visível.
  const dayAgo = Math.floor(Date.now() / 1000) - 24 * 3600;
  const last24h = items.filter((it) => it.time == null || it.time >= dayAgo);

  const coverage = {};
  FEEDS.forEach((feed) => {
    const feedItems = items.filter((it) => it.feed === feed.label);
    if (!feedItems.length) return;
    const oldest = feedItems[feedItems.length - 1].time;
    const hoursAvailable = oldest ? (Date.now() / 1000 - oldest) / 3600 : null;
    coverage[feed.label] = { count: feedItems.length, hoursAvailable: hoursAvailable != null ? Math.round(hoursAvailable * 10) / 10 : null };
  });

  // Imagem de capa pra cada matéria do RSS (que não vem com imagem nenhuma — só
  // texto/link). O <meta property="og:image"> de cada artigo fica no <head>, então lê só
  // os primeiros ~64KB da página (não a página inteira) até achar a tag e aí já cancela o
  // download — bem mais leve que baixar o artigo completo pra cada uma das ~50-80 matérias.
  const withImages = await Promise.allSettled(
    last24h.map(async (it) => ({ ...it, image: await fetchOgImage(it.link) }))
  );
  const finalItems = withImages.map((r, i) => (r.status === 'fulfilled' ? r.value : last24h[i]));

  return res.json({ items: finalItems, errors, topStory, coverage });
}

// Pacote de destaque (hero + 2 cards secundários) igual à home da CNBC — uma única
// requisição extra à página, sem visitar artigo por artigo (pesado). Se a estrutura da
// página mudar e o regex não encontrar nada, simplesmente devolve null e a aba TOP NEWS
// cai de volta pra lista comum do RSS, sem quebrar o resto.
async function scrapeTopStory() {
  try {
    const r = await fetch('https://www.cnbc.com/world/?region=world', { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const html = await r.text();

    const heroSectionMatch = html.match(/<div class="FeaturedNewsHero-container"[\s\S]*?<div class="SecondaryCardContainer-container">/);
    const heroBlock = heroSectionMatch ? heroSectionMatch[0] : '';
    const heroTitleMatch = heroBlock.match(/<h2 class="FeaturedCard-packagedCardTitle"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/);
    if (!heroTitleMatch) return null;
    const heroImgMatch = heroBlock.match(/<img src="([^"]+)"/);
    const subItems = [...heroBlock.matchAll(/<a href="([^"]+)" class="PackageItem-link"[^>]*>([\s\S]*?)<!--/g)]
      .map(m => ({ link: decodeHtmlEntities(m[1]), title: decodeHtmlEntities(stripTags(m[2])) }))
      .filter(s => s.title);

    const hero = {
      link: decodeHtmlEntities(heroTitleMatch[1]),
      title: decodeHtmlEntities(stripTags(heroTitleMatch[2])),
      image: heroImgMatch ? decodeHtmlEntities(heroImgMatch[1]) : null,
      subItems,
    };

    const secondary = [...html.matchAll(/<div class="SecondaryCard-container">[\s\S]*?<\/div><\/div><\/li>/g)]
      .slice(0, 4)
      .map((m) => {
        const block = m[0];
        const img = block.match(/<img src="([^"]+)"/);
        const headline = block.match(/<div class="SecondaryCard-headline"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!headline) return null;
        return {
          link: decodeHtmlEntities(headline[1]),
          title: decodeHtmlEntities(stripTags(headline[2])),
          image: img ? decodeHtmlEntities(img[1]) : null,
        };
      })
      .filter(Boolean);

    return { hero, secondary };
  } catch (_) {
    return null;
  }
}

function stripTags(str) {
  return (str || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').trim();
}

function parseRssItems(xml, feedLabel) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const title = decodeXmlEntities(extractTag(block, 'title'));
    const link = decodeXmlEntities(extractTag(block, 'link'));
    const description = decodeXmlEntities(extractTag(block, 'description'));
    const pubDate = extractTag(block, 'pubDate');
    if (!title || !link) continue;
    const time = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : null;
    items.push({ title, link, publisher: `CNBC · ${feedLabel}`, feed: feedLabel, time, summary: description });
  }
  return items;
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

function decodeXmlEntities(str) {
  return (str || '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Igual decodeXmlEntities, mas cobre também as entidades numéricas (&#x27; &#8217; etc.)
// que aparecem no HTML da home (o RSS só usa as nomeadas acima).
function decodeHtmlEntities(str) {
  return decodeXmlEntities(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}
