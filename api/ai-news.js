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

// region: 'nacional' pras fontes brasileiras (G1, Brazil Journal, InfoMoney, NeoFeed, Poder360
// — brasileiras por natureza), 'internacional' pro resto (CNBC, Reuters, Investing.com, BBC).
const SOURCES = [
  {
    // G1 geral foi trocado por só as editorias Economia e Política (a pedido do usuário) —
    // mesmo padrão de RSS por editoria do G1 (/rss/g1/{editoria}/), mesma fonte "G1".
    name: 'G1', region: 'nacional',
    urls: ['https://g1.globo.com/rss/g1/economia/', 'https://g1.globo.com/rss/g1/politica/'],
  },
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
  { name: 'NeoFeed', region: 'nacional', urls: ['https://neofeed.com.br/feed/'] },
  { name: 'Poder360', region: 'nacional', urls: ['https://www.poder360.com.br/feed/'] },
  {
    name: 'BBC', region: 'internacional',
    urls: ['https://feeds.bbci.co.uk/news/world/rss.xml', 'https://feeds.bbci.co.uk/news/business/rss.xml'],
  },
  // Valor Econômico — pago, mas expõe RSS público de headline/resumo (sem paywall na
  // listagem, só no artigo completo) igual ao G1. Sem login necessário.
  { name: 'Valor', region: 'nacional', urls: ['https://valor.globo.com/rss/valor/'] },
  // WSJ — os feeds públicos oficiais (feeds.a.dj.com) existem mas estão MORTOS (confirmado:
  // pubDate parado em jan/2025 ou antes, em todos eles) — provavelmente abandonados pela Dow
  // Jones. Usamos Google News como proxy (igual Reuters/Bloomberg) em vez deles. A homepage
  // (wsj.com) devolve 401 pra fetch simples, então cai pro proxy antigo de "manchete" (top 3
  // do feed) em vez do homepage scraping. Sem login necessário.
  {
    name: 'WSJ', region: 'internacional',
    urls: ['https://news.google.com/rss/search?q=site:wsj.com+when:2d&hl=en-US&gl=US&ceid=US:en'],
  },
  // Bloomberg — sem RSS oficial (descontinuado) e a home/latinamerica bloqueia scraping direto
  // (403 mesmo sem login, é bloqueio de bot na borda, não parede de login). Usamos o Google
  // News como proxy, igual ao Reuters — cobre Bloomberg em geral, não só a edição Latin America
  // especificamente (Google News não indexa por edição regional do site).
  {
    name: 'Bloomberg', region: 'internacional',
    urls: ['https://news.google.com/rss/search?q=site:bloomberg.com+when:2d&hl=en-US&gl=US&ceid=US:en'],
  },
];

// Homepage de cada fonte, usada pra checar se uma matéria está de fato em destaque na página
// inicial (sinal real de "manchete", em vez do proxy fraco de "top 3 do feed RSS"). Reuters
// fica de fora — não tem homepage própria checável (usamos Google News como proxy pro feed,
// que não reflete a home real do site) — mantém o proxy antigo (top 3 da página 1) só pra ela.
const SOURCE_HOMEPAGES = {
  G1: 'https://g1.globo.com/',
  CNBC: 'https://www.cnbc.com/world/',
  'Brazil Journal': 'https://braziljournal.com/',
  InfoMoney: 'https://www.infomoney.com.br/',
  'Investing.com': 'https://www.investing.com/',
  NeoFeed: 'https://neofeed.com.br/',
  Poder360: 'https://www.poder360.com.br/',
  BBC: 'https://www.bbc.com/',
  Valor: 'https://valor.globo.com/',
  // WSJ e Bloomberg ficam de fora — wsj.com devolve 401 pra fetch simples (paywall na borda) e
  // bloomberg.com devolve 403 (bloqueio de bot). Caem pro proxy antigo de "manchete".
};

// Caminho (sem domínio/query/hash) de uma URL — pra comparar link do RSS com link da home
// ignorando diferenças de protocolo, subdomínio, parâmetros de tracking etc.
function urlPath(url, base) {
  try {
    return new URL(url, base).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url;
  }
}

// Baixa a homepage de uma fonte e extrai o conjunto de caminhos linkados nela — usado pra
// saber quais matérias do feed RSS estão de fato em destaque na home agora.
async function fetchHomepagePaths(baseUrl) {
  const r = await fetchWithTimeout(baseUrl);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const paths = new Set();
  const hrefRe = /<a[^>]+href=["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(html))) {
    paths.add(urlPath(m[1], baseUrl));
  }
  return paths;
}

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
  'bolsa de valores', 'stock market', 'stocks', 'equities', 'renda fixa',
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
  'corrupção', 'corruption', 'sanções', 'sanctions',
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
  'ataque aéreo', 'air strike', 'mobilização militar',
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
  'credit growth', 'inadimplência', 'loan delinquency', 'consumer spending',
  'investimento empresarial', 'business investment', 'formação bruta de capital',
  'capital formation', 'capital expenditure', 'capex', 'PMI', 'ISM', 'IBC-Br', 'Focus',
  'Payroll', 'nonfarm payrolls', 'jobless claims', 'pedidos de seguro-desemprego',
  'surpresa', 'unexpected', 'surprise',
  'acima do esperado', 'above expectations', 'abaixo do esperado', 'below expectations',
  'recorde', 'record high', 'record low', 'colapso', 'collapse', 'disparada', 'surge',
  'queda acentuada', 'plunge', 'demissão', 'resignation', 'fired', 'renúncia', 'fraude',
  'fraud', 'valuation', 'avaliação', 'earnings', 'receita', 'revenue',
  'EBITDA', 'EPS', 'lucro por ação', 'cash flow', 'fluxo de caixa', 'free cash flow',
  'fluxo de caixa livre', 'debt', 'dívida', 'leverage', 'alavancagem', 'spread', 'yield',
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
// genéricos em português com sentido duplo e bateram em notícias sem nenhuma relação com o
// escopo da aba. Removemos os piores ofensores (termos isolados e ambíguos, ver histórico) e
// subimos a exigência pra 3+ termos DISTINTOS — reduz bem mais o ruído do que 2+, ao custo de
// eventualmente perder alguma matéria legítima com vocabulário mais enxuto.
const MIN_KEYWORD_MATCHES = 3;

// Conta quantas palavras-chave DISTINTAS batem.
function countKeywordMatches(text) {
  let count = 0;
  for (const re of KEYWORD_PATTERNS) {
    if (re.test(text)) count++;
  }
  return count;
}

function evaluateKeywords(title, summary) {
  const text = normalize(`${title} ${summary}`);
  if (EXCLUDE_RE.test(text)) return false;
  return countKeywordMatches(text) >= MIN_KEYWORD_MATCHES;
}

// ── Nota de relevância (1-10) ────────────────────────────────────────────────────────────────
// Duas categorias de 1 a 5 cada: (a) quantos veículos distintos noticiaram a mesma história —
// 2 pontos por veículo, até 5 (2 veículos já bate o teto); (b) se o link da matéria está de fato
// presente na homepage da fonte agora (raspagem real da home, ver SOURCE_HOMEPAGES/
// fetchHomepagePaths acima) — 5 se estiver, 1 se não. Reuters (sem homepage própria checável,
// só o proxy Google News) e qualquer fonte cuja homepage falhe ao buscar caem pro proxy antigo:
// top 3 posições da página 1 do próprio feed RSS. "Top Picks" = nota final >= 6.
const TOP_PICK_MIN_SCORE = 6;

// Pontos por veículo distinto que noticia a mesma história — nacional pesa menos que
// internacional (a pedido do usuário), até o teto de 5.
const OUTLET_WEIGHT = { nacional: 1.5, internacional: 2 };
const SOURCE_REGION = Object.fromEntries(SOURCES.map((s) => [s.name, s.region]));

// Temas de interesse direto do usuário (juros/política monetária de bancos centrais, mercado
// de ações americano com foco em IA, geopolítica) — bônus de nota pra destacar mesmo sem
// múltiplos veículos cobrindo ou estar na home. Curadoria pessoal, não confundir com a lista
// de inclusão (KEYWORDS) — essa aqui não filtra nada, só dá pontos extra.
const PRIORITY_KEYWORDS = [
  // Juros / bancos centrais
  'Fed', 'Federal Reserve', 'FOMC', 'Powell', 'Copom', 'Banco Central', 'Selic', 'Galípolo',
  'BCE', 'ECB', 'Lagarde', 'Bank of Japan', 'BoJ', 'Bank of England', 'BoE', 'corte de juros',
  'alta de juros', 'rate cut', 'rate hike', 'quantitative easing', 'quantitative tightening',
  'meta de inflação', 'dot plot',
  // Mercado de ações US / IA
  'S&P 500', 'Nasdaq', 'Dow Jones', 'Wall Street', 'Magnificent Seven', 'Nvidia', 'Microsoft',
  'Alphabet', 'Google', 'Meta', 'Amazon', 'Apple', 'Broadcom', 'AMD', 'TSMC', 'OpenAI',
  'Anthropic', 'Oracle', 'Palantir', 'CoreWeave', 'earnings season', 'resultados trimestrais',
  'guidance', 'capex de IA',
  // Geopolítica
  'China', 'Taiwan', 'Rússia', 'Russia', 'Ucrânia', 'Ukraine', 'Irã', 'Iran', 'Israel',
  'Oriente Médio', 'Middle East', 'OPEP', 'OPEC', 'tarifas', 'tariffs', 'trade war', 'sanções',
  'sanctions',
];
const PRIORITY_PATTERNS = [...new Set(PRIORITY_KEYWORDS.map(normalize))].map((k) => new RegExp(`\\b${escapeRegex(k)}\\b`));
const PRIORITY_BONUS = 2;

function matchesPriority(title, summary) {
  const text = normalize(`${title} ${summary}`);
  return PRIORITY_PATTERNS.some((re) => re.test(text));
}

// Duas manchetes sobre a MESMA notícia raramente têm a escrita parecida ("BP's $5.7bn profit
// highest since 2022..." vs "BP profit more than doubles as Trump blasts Big Oil...") — um
// Jaccard simples de palavras subestima isso, porque as palavras que sobram em comum tendem a
// ser genéricas (que aparecem em dezenas de outras matérias no mesmo ciclo, ex: "oil", "war")
// e a palavra que de fato identifica a história ("BP") é curta e ficava fora do corte de
// tamanho mínimo. Corrigido com peso tipo TF-IDF: cada palavra pesa pelo inverso de quantas
// matérias do ciclo a contêm — "BP" (rara no ciclo) pesa muito mais que "oil"/"war" (comuns).
const STOPWORDS = new Set([
  'para', 'como', 'mais', 'sobre', 'entre', 'depois', 'antes', 'contra', 'diz', 'disse',
  'após', 'nesta', 'neste', 'pode', 'deve', 'ainda', 'também', 'quando', 'onde', 'uma', 'um',
  'dos', 'das', 'dia', 'ser', 'ter', 'foi', 'são', 'com', 'por', 'que', 'não', 'dos', 'dia',
  'with', 'from', 'that', 'this', 'have', 'says', 'after', 'before', 'about', 'their',
  'will', 'what', 'which', 'into', 'over', 'amid', 'the', 'and', 'for', 'are', 'was', 'were',
  'has', 'had', 'not', 'its', 'his', 'her', 'you', 'but', 'all', 'can', 'new',
]);
const MIN_WORD_LEN = 2;
const CLUSTER_SIMILARITY = 0.22; // limiar do cosseno ponderado por idf, calibrado com casos reais
const CLUSTER_MAX_TIME_GAP = 48 * 3600; // fora dessa janela, mesma palavra rara é coincidência

function titleWordSet(title) {
  const norm = normalize(title).replace(/[^a-z0-9\s]/g, ' ');
  return new Set(norm.split(/\s+/).filter((w) => w.length >= MIN_WORD_LEN && !STOPWORDS.has(w)));
}

// idf(palavra) = log((N+1)/(df+1)) + 1 — sempre positivo, mais alto pra palavras raras no ciclo.
function computeIdf(wordSets) {
  const df = new Map();
  for (const set of wordSets) for (const w of set) df.set(w, (df.get(w) || 0) + 1);
  const n = wordSets.length;
  const idf = new Map();
  for (const [w, count] of df) idf.set(w, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

// Similaridade tipo cosseno: presença binária de cada palavra, ponderada por idf.
function weightedSimilarity(a, b, idf) {
  let inter = 0, normA = 0, normB = 0;
  for (const w of a) { const wt = idf.get(w) || 1; normA += wt * wt; if (b.has(w)) inter += wt; }
  for (const w of b) { const wt = idf.get(w) || 1; normB += wt * wt; }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : inter / denom;
}

// Cluster por similaridade de título entre fontes diferentes (mesma história, manchetes
// distintas) — o(n²) mas o volume por ciclo (algumas centenas de itens) não pesa.
function assignRelevance(items) {
  const wordSets = items.map((it) => titleWordSet(it.title));
  const idf = computeIdf(wordSets);
  items.forEach((it, i) => {
    const outlets = new Set([it.source]);
    for (let j = 0; j < items.length; j++) {
      if (j === i || items[j].source === it.source) continue;
      const gap = it.time != null && items[j].time != null ? Math.abs(it.time - items[j].time) : 0;
      if (gap > CLUSTER_MAX_TIME_GAP) continue;
      if (weightedSimilarity(wordSets[i], wordSets[j], idf) >= CLUSTER_SIMILARITY) outlets.add(items[j].source);
    }
    let multiOutletScore = 0;
    for (const outlet of outlets) multiOutletScore += OUTLET_WEIGHT[SOURCE_REGION[outlet]] ?? 2;
    multiOutletScore = Math.min(5, multiOutletScore);
    const headlineScore = it.headline ? 5 : 1;
    const priorityBonus = matchesPriority(it.title, it.summary) ? PRIORITY_BONUS : 0;
    it.relevanceScore = Math.min(10, Math.round((multiOutletScore + headlineScore + priorityBonus) * 10) / 10);
    it.topPick = it.relevanceScore >= TOP_PICK_MIN_SCORE;
    delete it.headline;
  });
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

async function fetchSource(source, homepagePaths) {
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
    const isPage1 = tasks[i].page === 1;
    r.value.forEach((raw, idx) => {
      if (seenLinks.has(raw.link)) return;
      const title = cleanTitle(cleanText(raw.title), source.name);
      if (!isMeaningfulTitle(title, source.name) || looksLikeJunk(title)) return;
      const titleKey = title.toLowerCase();
      if (seenTitles.has(titleKey)) return; // espelhos regionais da mesma fonte
      seenTitles.add(titleKey);
      seenLinks.add(raw.link);

      let summary = cleanText(raw.description);
      if (summary.startsWith(title)) summary = summary.slice(title.length).trim();
      if (summary.length <= source.name.length + 2) summary = '';

      if (!evaluateKeywords(title, summary)) return;

      // Sinal de "manchete" real: o link está na homepage da fonte agora? Fallback (fonte
      // sem homepage checável, ou homepage falhou ao buscar) pro proxy antigo — top 3 do
      // feed RSS na página 1.
      const headline = homepagePaths
        ? homepagePaths.has(urlPath(raw.link, source.urls[0]))
        : isPage1 && idx < 3;

      items.push({
        source: source.name, region: source.region, title, link: raw.link,
        publisher: source.name, summary, time: raw.time, headline,
      });
    });
  });

  return { items, error };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const homepagePathsBySource = {};
  await Promise.all(Object.entries(SOURCE_HOMEPAGES).map(async ([name, url]) => {
    try {
      homepagePathsBySource[name] = await fetchHomepagePaths(url);
    } catch {
      homepagePathsBySource[name] = null; // fetchSource cai pro proxy antigo (top 3 do feed)
    }
  }));

  const results = await Promise.allSettled(
    SOURCES.map((source) => fetchSource(source, homepagePathsBySource[source.name] || null)),
  );
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
  assignRelevance(all);
  all.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));

  const nacional = all.filter((it) => it.region === 'nacional');
  const internacional = all.filter((it) => it.region === 'internacional');

  return res.json({ nacional, internacional, errors });
}
