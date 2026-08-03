// Agregador de notícias — mercado financeiro, política, geopolítica, economia e IA/chips.
// Reciclado da metodologia de scraping em Python que o usuário já tinha rodando fora do
// terminal (Novo Projeto/newsterm/sources.py + fetcher.py): mesmas 6 fontes, mesma técnica
// de paginação WordPress (?paged=N), mesmo motivo pra usar Google News como proxy pro
// Reuters (bloqueia scraping direto via proteção DataDome e não tem mais RSS público
// próprio), mesma limpeza de título/resumo (sufixo "- Fonte", rodapé Jetpack "The post X
// appeared first on Y") e deduplicação por link. Diferença: aqui filtramos por uma lista
// FIXA de palavras-chave (em vez de busca sob demanda) — originalmente só IA/chips, depois
// ampliada pelo usuário pra cobrir mercado financeiro/política/geopolítica/economia em
// geral (por isso a aba se chama "Notícias", não mais "IA & Chips") — e separamos em
// Nacional (fontes brasileiras) vs Internacional (resto). Também tem uma lista de exclusão
// (curso, horóscopo, esporte, entretenimento, promoção etc.) pra descartar match positivo
// que caiu em conteúdo de lifestyle/publicidade em vez de notícia de verdade.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// region: 'nacional' pras fontes brasileiras (G1, Brazil Journal, InfoMoney — brasileiras por
// natureza), 'internacional' pro resto (CNBC, Reuters, Investing.com).
const SOURCES = [
  { name: 'G1', region: 'nacional', urls: ['https://g1.globo.com/rss/g1/'] },
  {
    name: 'CNBC', region: 'internacional',
    urls: [
      'https://www.cnbc.com/id/100727362/device/rss/rss.html', // International
      'https://www.cnbc.com/id/100003114/device/rss/rss.html', // US Top News
      'https://www.cnbc.com/id/10001147/device/rss/rss.html',  // Business
      'https://www.cnbc.com/id/20910258/device/rss/rss.html',  // Economy
      'https://www.cnbc.com/id/15839069/device/rss/rss.html',  // Investing
    ],
  },
  {
    name: 'Reuters', region: 'internacional',
    urls: ['https://news.google.com/rss/search?q=site:reuters.com+when:2d&hl=en-US&gl=US&ceid=US:en'],
  },
  { name: 'Brazil Journal', region: 'nacional', urls: ['https://braziljournal.com/feed/'], pages: 4 },
  { name: 'InfoMoney', region: 'nacional', urls: ['https://www.infomoney.com.br/feed/'], pages: 5 },
  {
    name: 'Investing.com', region: 'internacional',
    urls: [
      'https://www.investing.com/rss/news.rss',
      'https://www.investing.com/rss/news_25.rss',
      'https://www.investing.com/rss/news_301.rss',
      'https://www.investing.com/rss/market_overview.rss',
      'https://www.investing.com/rss/news_1.rss',
      'https://www.investing.com/rss/commodities.rss',
    ],
  },
];

// Janela de tempo padrão — mais larga que o CNBC do resto do terminal (24h) porque é um
// recorte por palavra-chave sobre 6 fontes que também publicam muita coisa fora do escopo;
// um corte de 24h deixaria a lista curta demais na maioria dos dias.
const HOURS_WINDOW = 72;

// Lista de inclusão — IA/chips, mercado financeiro, política, geopolítica e economia.
const KEYWORDS = [
  'inteligência artificial', 'artificial intelligence', 'IA generativa', 'generative AI',
  'enterprise AI', 'IA empresarial', 'large language model', 'large language models',
  'modelo de linguagem', 'modelos de linguagem', 'LLM', 'foundation model', 'foundation models',
  'modelo fundacional', 'modelos fundacionais', 'machine learning', 'aprendizado de máquina',
  'deep learning', 'aprendizado profundo', 'AI agents', 'agentes de IA', 'autonomous agents',
  'agentes autônomos', 'agentic AI', 'IA agêntica', 'multimodal AI', 'IA multimodal',
  'AI inference', 'inferência de IA', 'AI training', 'treinamento de IA', 'AI compute',
  'computação de IA', 'AI infrastructure', 'infraestrutura de IA', 'AI data center',
  'data center', 'data centers', 'centro de dados', 'centros de dados', 'AI chips',
  'chips de IA', 'semiconductors', 'semicondutores', 'AI accelerators', 'aceleradores de IA',
  'GPU', 'TPU', 'NPU', 'HBM', 'high bandwidth memory', 'memória de alta largura de banda',
  'cloud computing', 'computação em nuvem', 'AI capex', 'capex de IA', 'AI investment',
  'investimentos em IA', 'AI demand', 'demanda por IA', 'AI monetization', 'monetização de IA',
  'AI adoption', 'adoção de IA', 'AI regulation', 'regulação de IA', 'AI safety',
  'segurança de IA', 'AI governance', 'governança de IA', 'AI copyright',
  'direitos autorais e IA', 'data center energy', 'energia para data centers',
  'AI power demand', 'demanda de energia para IA',
  'OpenAI', 'Anthropic', 'Google DeepMind', 'Microsoft AI', 'Meta AI', 'Amazon AWS AI',
  'Oracle AI', 'Nvidia', 'AMD', 'Broadcom', 'TSMC', 'ASML', 'Applied Materials',
  'Lam Research', 'Micron', 'SK Hynix', 'Samsung Electronics', 'CoreWeave', 'xAI',
  'Palantir', 'Arm Holdings',
  'mercado financeiro', 'financial markets', 'mercados globais', 'global markets',
  'bolsa de valores', 'stock market', 'ações', 'stocks', 'equities', 'renda fixa',
  'fixed income', 'títulos públicos', 'government bonds', 'títulos corporativos',
  'corporate bonds', 'debêntures', 'bonds', 'crédito privado', 'private credit',
  'mercado de crédito', 'credit markets', 'spread de crédito', 'credit spread',
  'curva de juros', 'yield curve', 'juros futuros', 'interest rate futures',
  'taxa de juros', 'interest rates', 'Selic', 'Tesouro Direto', 'Treasuries',
  'Treasury yields', 'câmbio', 'foreign exchange', 'FX', 'FX market', 'dólar', 'US dollar',
  'real', 'Brazilian real', 'euro', 'commodities', 'petróleo', 'oil', 'oil prices', 'ouro',
  'gold', 'gold prices', 'minério de ferro', 'iron ore', 'criptomoedas', 'cryptocurrency',
  'Bitcoin', 'Ethereum', 'volatilidade', 'market volatility', 'liquidez', 'market liquidity',
  'fluxo estrangeiro', 'foreign flows', 'capital flows', 'fluxo de capital',
  'foreign inflows', 'foreign outflows', 'aversão a risco', 'risk aversion',
  'apetite a risco', 'risk appetite', 'risk-on', 'risk-off', 'correção de mercado',
  'market correction', 'rali', 'market rally', 'sell-off', 'drawdown', 'mercado em alta',
  'bull market', 'mercado em baixa', 'bear market', 'resultados corporativos',
  'corporate earnings', 'temporada de balanços', 'earnings season', 'guidance',
  'revisão de guidance', 'guidance cut', 'guidance raise', 'profit warning',
  'alerta de lucro', 'recompra de ações', 'share buyback', 'dividendos', 'dividend',
  'fusão', 'merger', 'aquisição', 'acquisition', 'fusão e aquisição',
  'mergers and acquisitions', 'M&A', 'takeover', 'oferta pública',
  'initial public offering', 'IPO', 'follow-on', 'secondary offering', 'default',
  'moratória', 'moratorium', 'reestruturação de dívida', 'debt restructuring',
  'rebaixamento de rating', 'credit downgrade', 'elevação de rating', 'credit upgrade',
  'Ibovespa', 'IBOV', 'S&P 500', 'Nasdaq', 'Dow Jones', 'Russell 2000', 'VIX', 'DXY',
  'US 10-year yield', '2-year Treasury', '10-year Treasury', '30-year Treasury', 'CDS',
  'high yield', 'investment grade', 'emerging markets', 'mercados emergentes',
  'MSCI World', 'MSCI Emerging Markets', 'Stoxx 600', 'Euro Stoxx 50', 'Nikkei',
  'Hang Seng', 'CSI 300', 'KOSPI',
  'política', 'politics', 'governo', 'government', 'Congresso', 'Congress',
  'Câmara dos Deputados', 'House of Representatives', 'Senado', 'Senate',
  'Supremo Tribunal Federal', 'Supreme Court', 'STF', 'Executivo', 'executive branch',
  'Legislativo', 'legislature', 'Judiciário', 'judiciary', 'presidente', 'president',
  'ministro da Fazenda', 'finance minister', 'Treasury secretary', 'Banco Central',
  'central bank', 'eleições', 'election', 'Lula', 'Bolsonaro', 'Renan Santos',
  'Rodrigo Caiado', 'Zema', 'campanha eleitoral', 'electoral campaign',
  'pesquisa eleitoral', 'opinion poll', 'aprovação do governo', 'approval rating',
  'coalizão', 'coalition', 'oposição', 'opposition', 'base governista', 'ruling party',
  'reforma econômica', 'economic reform', 'reforma tributária', 'tax reform',
  'reforma administrativa', 'administrative reform', 'política fiscal', 'fiscal policy',
  'arcabouço fiscal', 'fiscal framework', 'meta fiscal', 'fiscal target',
  'orçamento público', 'government budget', 'déficit público', 'budget deficit',
  'superávit', 'budget surplus', 'dívida pública', 'public debt', 'gastos públicos',
  'government spending', 'spending cuts', 'corte de gastos', 'subsídio', 'subsidy',
  'privatização', 'privatization', 'estatização', 'nationalization', 'regulação',
  'regulation', 'sanção presidencial', 'presidential approval', 'veto presidencial',
  'presidential veto', 'medida provisória', 'executive order', 'projeto de lei', 'bill',
  'legislation', 'PEC', 'decreto', 'presidential decree', 'government shutdown',
  'impeachment', 'crise política', 'political crisis', 'protestos', 'protests',
  'corrupção', 'corruption', 'investigação', 'investigation', 'sanções', 'sanctions',
  'market reaction', 'reação do mercado', 'investor reaction', 'reação dos investidores',
  'policy uncertainty', 'incerteza política', 'political risk', 'risco político',
  'fiscal risk', 'risco fiscal', 'regulatory risk', 'risco regulatório', 'election risk',
  'risco eleitoral', 'government intervention', 'intervenção do governo',
  'capital controls', 'controle de capitais', 'windfall tax',
  'imposto sobre lucros extraordinários', 'tariffs', 'tarifas', 'trade restrictions',
  'restrições comerciais', 'corporate tax', 'imposto corporativo', 'wealth tax',
  'imposto sobre patrimônio', 'financial transaction tax',
  'imposto sobre transações financeiras',
  'geopolítica', 'geopolitics', 'tensão geopolítica', 'geopolitical tensions',
  'conflito internacional', 'international conflict', 'guerra', 'war', 'cessar-fogo',
  'ceasefire', 'negociações de paz', 'peace talks', 'ataque militar', 'military strike',
  'ataque aéreo', 'air strike', 'invasão', 'invasion', 'mobilização militar',
  'military mobilization', 'escalada militar', 'military escalation', 'desescalada',
  'de-escalation', 'sanções econômicas', 'economic sanctions', 'embargo',
  'bloqueio comercial', 'trade blockade', 'guerra comercial', 'trade war', 'retaliação',
  'retaliation', 'restrições à exportação', 'export restrictions', 'controle de exportações',
  'export controls', 'segurança nacional', 'national security', 'OTAN', 'NATO',
  'União Europeia', 'European Union', 'ONU', 'United Nations', 'Conselho de Segurança',
  'UN Security Council', 'G7', 'G20', 'BRICS', 'Oriente Médio', 'Middle East',
  'Mar do Sul da China', 'South China Sea', 'Taiwan', 'Estreito de Taiwan',
  'Taiwan Strait', 'Ucrânia', 'Ukraine', 'Rússia', 'Russia', 'China', 'Estados Unidos',
  'United States', 'Irã', 'Iran', 'Israel', 'Coreia do Norte', 'North Korea', 'Venezuela',
  'OPEP', 'OPEC', 'OPEP+', 'OPEC+', 'rotas marítimas', 'shipping routes', 'Mar Vermelho',
  'Red Sea', 'Canal de Suez', 'Suez Canal', 'Estreito de Ormuz', 'Strait of Hormuz',
  'cadeias de suprimento', 'supply chains', 'segurança energética', 'energy security',
  'segurança alimentar', 'food security', 'missile attack', 'ataque de míssil',
  'drone attack', 'ataque de drone', 'border conflict', 'conflito de fronteira',
  'nuclear talks', 'negociações nucleares', 'nuclear program', 'programa nuclear',
  'military exercise', 'exercício militar', 'shipping disruption', 'interrupção marítima',
  'port closure', 'fechamento de porto', 'pipeline disruption',
  'interrupção de gasoduto', 'oil supply disruption',
  'interrupção no fornecimento de petróleo', 'gas supply disruption',
  'interrupção no fornecimento de gás', 'commodity export ban',
  'proibição de exportação de commodities', 'rare earth export controls',
  'controle de exportação de terras raras', 'semiconductor export controls',
  'controle de exportação de semicondutores', 'foreign investment restrictions',
  'restrições a investimentos estrangeiros',
  'economia', 'economy', 'atividade econômica', 'economic activity',
  'crescimento econômico', 'economic growth', 'PIB', 'GDP', 'recessão', 'recession',
  'desaceleração econômica', 'economic slowdown', 'expansão econômica',
  'economic expansion', 'produção industrial', 'industrial production',
  'vendas no varejo', 'retail sales', 'setor de serviços', 'services sector',
  'confiança do consumidor', 'consumer confidence', 'confiança empresarial',
  'business confidence', 'mercado de trabalho', 'labor market', 'emprego', 'employment',
  'desemprego', 'unemployment', 'salários', 'wages', 'renda', 'income', 'produtividade',
  'productivity', 'inflação', 'inflation', 'deflação', 'deflation', 'desinflação',
  'disinflation', 'IPCA', 'IGP-M', 'IPC', 'CPI', 'PCE', 'PPI', 'núcleo da inflação',
  'core inflation', 'expectativas de inflação', 'inflation expectations',
  'política monetária', 'monetary policy', 'Copom', 'Federal Reserve', 'Fed',
  'European Central Bank', 'BCE', 'ECB', 'Bank of England', 'BoE', 'Bank of Japan', 'BoJ',
  'corte de juros', 'interest rate cut', 'rate cut', 'alta de juros', 'rate hike',
  'manutenção de juros', 'rates on hold', 'aperto monetário', 'monetary tightening',
  'flexibilização monetária', 'monetary easing', 'quantitative easing',
  'quantitative tightening', 'balanço de pagamentos', 'balance of payments',
  'conta corrente', 'current account', 'balança comercial', 'trade balance',
  'exportações', 'exports', 'importações', 'imports', 'reservas internacionais',
  'foreign exchange reserves', 'déficit fiscal', 'fiscal deficit', 'resultado primário',
  'primary balance', 'arrecadação', 'tax revenue', 'crédito bancário', 'bank lending',
  'credit growth', 'inadimplência', 'loan delinquency', 'consumo', 'consumer spending',
  'investimento empresarial', 'business investment', 'formação bruta de capital',
  'capital formation', 'capital expenditure', 'capex', 'PMI', 'ISM', 'IBC-Br', 'Focus',
  'Payroll', 'nonfarm payrolls', 'jobless claims', 'pedidos de seguro-desemprego',
  'urgente', 'breaking', 'última hora', 'just in', 'surpresa', 'unexpected', 'surprise',
  'acima do esperado', 'above expectations', 'abaixo do esperado', 'below expectations',
  'recorde', 'record high', 'record low', 'colapso', 'collapse', 'disparada', 'surge',
  'queda acentuada', 'plunge', 'demissão', 'resignation', 'fired', 'renúncia', 'fraude',
  'fraud', 'intervenção', 'intervention', 'ataque', 'attack', 'mercados', 'markets',
  'investidores', 'investors', 'valuation', 'avaliação', 'earnings', 'receita', 'revenue',
  'EBITDA', 'EPS', 'lucro por ação', 'cash flow', 'fluxo de caixa', 'free cash flow',
  'fluxo de caixa livre', 'debt', 'dívida', 'leverage', 'alavancagem', 'spread', 'yield',
  'retorno', 'taxa',
];

// Lista de exclusão — descarta match positivo que caiu em conteúdo de lifestyle/
// publicidade/spam em vez de notícia de verdade (ex: "curso de trading", "review de
// produto", "promoção", que podem acidentalmente conter alguma palavra-chave acima).
const EXCLUDE_KEYWORDS = [
  'curso', 'course', 'apostila', 'tutorial', 'o que é', 'definition', 'definição',
  'meaning', 'significado', 'vaga', 'job opening', 'career advice', 'concurso público',
  'horóscopo', 'sports', 'esporte', 'football', 'futebol', 'celebrity', 'celebridade',
  'entertainment', 'entretenimento', 'movie', 'filme', 'TV series', 'série', 'gaming',
  'jogo eletrônico', 'product review', 'review', 'promoção', 'discount', 'cupom',
  'coupon', 'sponsored content', 'conteúdo patrocinado', 'advertisement', 'publicidade',
];

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeywordRegex(list) {
  return new RegExp(
    [...new Set(list.map(normalize))].map((k) => `\\b${escapeRegex(k)}\\b`).join('|'),
  );
}

// Palavras-chave individuais precompiladas — usadas pra CONTAR quantas batem, não só se
// pelo menos uma bate (ver MIN_KEYWORD_MATCHES abaixo).
const KEYWORD_PATTERNS = [...new Set(KEYWORDS.map(normalize))].map((k) => new RegExp(`\\b${escapeRegex(k)}\\b`));
const EXCLUDE_RE = buildKeywordRegex(EXCLUDE_KEYWORDS);

// Exigir só 1 palavra-chave batendo dava muito falso positivo — vários termos da lista são
// genéricos em português com sentido duplo ("ações" = tanto "stocks" quanto "legal actions",
// "consumo" = tanto "consumer spending" quanto "consumo de água", "retorno"/"taxa"/
// "intervenção"/"invasão" idem) e bateram em notícias de água, clima, crime, sem nenhuma
// relação com o escopo da aba. Exigir 2+ termos DISTINTOS reduz drasticamente esse ruído sem
// precisar remover nada da lista — uma notícia de verdade sobre o tema costuma trazer mais de
// um termo junto (ex: "Selic" + "Copom", ou "Nvidia" + "data center").
const MIN_KEYWORD_MATCHES = 2;

function matchesKeywords(title, summary) {
  const text = normalize(`${title} ${summary}`);
  if (EXCLUDE_RE.test(text)) return false;
  let count = 0;
  for (const re of KEYWORD_PATTERNS) {
    if (re.test(text)) {
      count++;
      if (count >= MIN_KEYWORD_MATCHES) return true;
    }
  }
  return false;
}

// ── Limpeza de título/resumo (mesma lógica do fetcher.py) ───────────────────────────────────
const JUNK_TITLE_PATTERNS = [
  'candlestick chart', 'compare against competitors', 'share price today',
  'stock price |', 'stock price history', 'shares outstanding',
  'technical analysis, rsi', 'option chain', 'return on assets',
  'market cap', 'currency converter', 'dividend history', 'earnings per share',
];

function looksLikeJunk(title) {
  const lowered = title.toLowerCase();
  return JUNK_TITLE_PATTERNS.some((p) => lowered.includes(p));
}

function isMeaningfulTitle(title, source) {
  if (!title) return false;
  const remaining = title.toLowerCase().replace(source.toLowerCase(), '').replace(/^[\s\-|,]+|[\s\-|,]+$/g, '');
  return remaining.length >= 10;
}

function cleanText(raw) {
  if (!raw) return '';
  let text = decodeHtmlEntities(raw.replace(/<[^>]+>/g, ''));
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/\s*The post .*? appeared first on .*?\.\s*$/i, '');
  return text;
}

function cleanTitle(title, source) {
  let t = title;
  if (t.includes(' - ')) {
    const idx = t.lastIndexOf(' - ');
    const head = t.slice(0, idx);
    const tail = t.slice(idx + 3);
    if (tail.toLowerCase().includes(source.toLowerCase())) t = head;
  }
  const bySuffix = ` by ${source}`.toLowerCase();
  if (t.toLowerCase().endsWith(bySuffix)) t = t.slice(0, t.length - bySuffix.length);
  t = t.trim();
  if (t.startsWith('- ')) t = t.slice(2).trim();
  return t;
}

function decodeXmlEntities(str) {
  return (str || '')
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function decodeHtmlEntities(str) {
  return decodeXmlEntities(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

function parseRssItems(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks) {
    const title = decodeXmlEntities(extractTag(block, 'title'));
    const link = decodeXmlEntities(extractTag(block, 'link'));
    const description = decodeXmlEntities(extractTag(block, 'description'));
    const pubDate = extractTag(block, 'pubDate');
    if (!title || !link) continue;
    const time = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : null;
    items.push({ title, link, description, time });
  }
  return items;
}

function pagedUrl(url, page) {
  if (page <= 1) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}paged=${page}`;
}

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSource(source) {
  const tasks = [];
  for (const url of source.urls) {
    for (let page = 1; page <= (source.pages || 1); page++) {
      tasks.push({ url: pagedUrl(url, page), page });
    }
  }

  const results = await Promise.allSettled(tasks.map(async ({ url, page }) => {
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      if (r.status === 404 && page > 1) return []; // paginação além do fim do feed
      throw new Error(`HTTP ${r.status}`);
    }
    return parseRssItems(await r.text());
  }));

  const seenLinks = new Set();
  const seenTitles = new Set();
  const items = [];
  let error = null;
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      if (tasks[i].page === 1) error = `${source.name}: ${r.reason?.message || 'erro'}`;
      return;
    }
    for (const raw of r.value) {
      if (seenLinks.has(raw.link)) continue;
      const title = cleanTitle(cleanText(raw.title), source.name);
      if (!isMeaningfulTitle(title, source.name) || looksLikeJunk(title)) continue;
      const titleKey = title.toLowerCase();
      if (seenTitles.has(titleKey)) continue; // espelhos regionais da mesma fonte
      seenTitles.add(titleKey);
      seenLinks.add(raw.link);

      let summary = cleanText(raw.description);
      if (summary.startsWith(title)) summary = summary.slice(title.length).trim();
      if (summary.length <= source.name.length + 2) summary = '';

      if (!matchesKeywords(title, summary)) continue;

      items.push({
        source: source.name, region: source.region, title, link: raw.link,
        publisher: source.name, summary, time: raw.time,
      });
    }
  });

  return { items, error };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const errors = [];
  let all = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      all = all.concat(r.value.items);
      if (r.value.error) errors.push(r.value.error);
    } else {
      errors.push(`${SOURCES[i].name}: ${r.reason?.message || 'erro'}`);
    }
  });

  const cutoff = Math.floor(Date.now() / 1000) - HOURS_WINDOW * 3600;
  all = all.filter((it) => it.time == null || it.time >= cutoff);
  all.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));

  const nacional = all.filter((it) => it.region === 'nacional');
  const internacional = all.filter((it) => it.region === 'internacional');

  return res.json({ nacional, internacional, errors });
}
