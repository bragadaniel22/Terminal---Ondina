# Terminal Financeiro — Metodologia e Documentação Técnica

> Documento de handoff completo — suficiente para qualquer sessão nova (Claude ou humano)
> entender o projeto do zero e continuar o trabalho sem perguntar de novo o que já foi decidido.
> Reescrito integralmente para refletir uma sessão longa e intensa de novas features — se você
> está lendo isso numa conversa nova, **leia até o fim antes de tocar em qualquer código**.

---

## 0. Status Atual (leia isto primeiro)

**Abas do terminal (6, nessa ordem):** ÍNDICES, SINGLE NAMES, PORTFÓLIO, ETFS INTERNOS, HEATMAP,
NOTÍCIAS.

**As abas BUSCAR e CNBC (BETA) foram REMOVIDAS numa sessão posterior** a pedido do usuário —
"CNBC não faz sentido, já temos o portal na parte de notícias" (a fonte CNBC já está coberta
dentro da aba NOTÍCIAS) e BUSCAR foi removida junto, mas a **barra de busca de ativos (sub-aba
ATIVOS) foi preservada e movida pra dentro da aba SINGLE NAMES** (card no topo, acima da grade
de equities — mesmo `runAssetSearch()`/`/api/quote-search`, só mudou de lugar). A sub-aba
NOTÍCIAS de BUSCAR (feed de notícias do mercado americano via Yahoo Finance + busca livre,
`loadFeed`/`fetchMarketNews`/`runFeedSearch`) foi apagada de vez — o `/api/news` continua
existindo pro botão de lupa 🔍 dos Single Names (`openTickerNews`, que sempre passa um ticker) e
pro "resumir com IA" (`action=summarize`), só não tem mais card dedicado de feed genérico.
Apagados: os botões de navegação das duas abas, os painéis HTML, todo o JS específico de CNBC
(`loadCnbc`, `filterCnbc`, `renderCnbcList`, `renderCnbcTopStory`, pacote de destaque
hero+secundários), o CSS `.cnbc-*`, o arquivo `api/cnbc-news.js` e a rota espelhada + função
`Get-CnbcTopStory` em `server.ps1`. **Não recriar essas abas sem que o usuário peça de novo.**

**Yahoo Finance foi adicionado como fonte da aba NOTÍCIAS** (RSS público em
`finance.yahoo.com/news/rssindex`, confirmado ativo/atualizado) — ver seção 15.1.

**Sistema de notificação (pop-up) adicionado à aba NOTÍCIAS**: com o terminal aberto (em
qualquer aba) ou ao abrir a página, uma notícia com nota de relevância ≥ 8,5 dispara um pop-up
no canto superior direito. Roda num ciclo próprio de 120s (`checkAiNewsNotifications`,
`startNotifyTimer`), separado do ciclo de 60s do resto do terminal, e usa `localStorage`
(`tf_notified_news_links`) pra nunca repetir a mesma notícia. Ver seção 15.1.

**A aba BONDS (BETA) foi REMOVIDA nessa sessão**, a pedido do usuário. Motivo: a API paga do
bondterminal.com (fonte de dados da aba) bateu **cota diária de cálculos esgotada** de forma
persistente, mesmo depois de corrigido um bug real de concorrência no código (ver seção 16,
mantida como registro histórico). Foram apagados: o botão de navegação, o painel HTML, os dois
modais (histórico de preço e Key Metrics), todo o JS (`loadBonds`, `openBondHistory`,
`openBondMetrics`, `loadBondHistory` e afins), o CSS `.bond-disclaimer`, os arquivos
`api/bonds.js` e `api/bonds-history.js`, e as rotas espelhadas em `server.ps1`. **Não recriar
essa aba sem que o usuário peça de novo explicitamente** — se pedir, reavaliar primeiro se o
problema de cota do bondterminal.com foi resolvido (upgrade de plano ou nova chave), senão o
mesmo problema se repete.

**A aba SIMULADOR (Markowitz) foi REMOVIDA numa sessão anterior** a pedido do usuário — todo o
código (~30 funções `mk*`), CSS e HTML foram apagados. `SIMULADOR_METODOLOGIA.md` continua no
repo como registro histórico da matemática (útil se algum dia quiserem recriar algo parecido),
mas **não reflete mais nenhuma aba existente** — não confundir com algo ativo.

**Pendências / decisões em aberto:**
1. **`GEMINI_API_KEY` precisa estar configurada no Vercel** para o botão "resumir com IA"
   (Busca e CNBC) funcionar em produção. Localmente, `$env:GEMINI_API_KEY`.
2. **Otimização de chamadas de API não implementada.** Discutido consolidar múltiplas chamadas de
   ticker do Yahoo Finance numa única função por categoria (reduziria invocações no Vercel em
   ~50%), mas o usuário (Daniel) ainda não decidiu se quer. Ver seção 18.
3. **Dados institucionais Reuters/LSEG**: pergunta em aberto de longa data — Daniel perguntou se
   conseguia usar a conta institucional dele (Refinitiv Workspace). Sem resposta se ele tem acesso
   via RDP (funcionaria) ou só Workspace (não funcionaria remotamente).
4. **`api/summary.js`** (resumo diário de IA via OpenAI) é órfão — primeira tentativa, substituída
   pelo resumo por notícia individual via Gemini. Não é usado pelo front-end.
5. **CNBC (BETA) e NOTÍCIAS** dependem de fontes de terceiros não controladas por nós
   (feeds RSS de vários veículos) — podem quebrar/mudar sem aviso. Ver seções 15 e 15.1.
6. **Regra importante de conteúdo:** este documento (e qualquer documentação gerada para o
   projeto) **não deve citar os tickers específicos dos Single Names** — preferência explícita do
   Daniel. Índices, futuros, commodities e ETFs internos podem ser citados normalmente (a regra é
   só sobre a lista pessoal de equities da aba SINGLE NAMES).
7. **Cuidado extra com credenciais nessa sessão**: o usuário colou no chat uma API key que
   pensava ser do bondterminal.com, mas era na verdade uma chave de produção **da Blueticks**
   (API de WhatsApp, sem relação com o projeto) — ver seção 20 antes de orientar sobre qualquer
   chave nova. Continua relevante mesmo com a aba Bonds removida, como lembrete geral de cuidado.

---

## 1. Visão Geral

**Terminal Financeiro** é um dashboard financeiro estilo Bloomberg construído como uma **única
página HTML** (`index.html`) com JavaScript puro, CSS embutido, sem frameworks front-end. Os
dados vêm de APIs públicas, proxiadas por **Vercel Serverless Functions** (`api/`) pra contornar
CORS. Uso real: até ~6 pessoas (Daniel + colegas).

Seis abas:
- **ÍNDICES** — painel de mercado global (Brasil, Bolsa US, Europa+Emerging Markets+Câmbio,
  Ásia&Pacífico — incluindo KOSPI, Juros Globais, Commodities&Cripto, NTN-B com histórico)
- **SINGLE NAMES** — 10 equities definidas pelo usuário (composição evolui — ver `SINGLES` /
  `PF_TICKERS` no código pra lista atual; não citar tickers em documentação), com data(s) de
  entrada na posição cadastradas, e uma barra de busca de ativos no topo (herdada da extinta
  aba BUSCAR — resolve texto livre em ticker, mostra cotação com gráfico clicável)
- **PORTFÓLIO** — simulador equal-weight com gráficos de desempenho relativo (vs. benchmark
  S&P 500) e risco×retorno
- **ETFS INTERNOS** — dois ETFs sintéticos (setor de equipamento e de memória de IA) montados
  internamente, com índice ponderado, modo intraday, e ativos originais (não-ADR, exceto ASML —
  ver seção 13.1) — ver seção 13
- **HEATMAP** — treemap visual estilo mapa de calor, 6 categorias (Single Names, Bolsa US,
  Índices Futuros, Europa+Ásia+EM, Commodities&Cripto)
- **NOTÍCIAS** — recorte por palavra-chave (IA/chips, mercado financeiro, política,
  geopolítica, economia) sobre várias fontes (Reuters, Brazil Journal, InfoMoney,
  Investing.com, NeoFeed, Poder360, CNBC, BBC, Valor, WSJ, Bloomberg, Yahoo Finance — G1 fica de
  fora por ora, ver seção 0), separado em NACIONAL/INTERNACIONAL/TOP PICKS, com nota de
  relevância (1-10) e sistema de notificação pop-up pra notícias de nota ≥ 8,5 — ver seção 15.1

~~**SIMULADOR**~~ — **removida numa sessão anterior**. Existia uma fronteira eficiente de
Markowitz; todo o código foi apagado a pedido do usuário. `SIMULADOR_METODOLOGIA.md` continua no
repo só como registro histórico da matemática.

~~**BONDS (BETA)**~~ — **removida numa sessão anterior** por cota diária esgotada persistente na
API paga do bondterminal.com. Ver seção 16 (mantida como registro histórico).

~~**BUSCAR**~~ e ~~**CNBC (BETA)**~~ — **removidas numa sessão posterior** a pedido do usuário
(CNBC redundante com a fonte CNBC já coberta em NOTÍCIAS). A busca de ativos de BUSCAR foi
preservada dentro de SINGLE NAMES. Ver seção 0.

Além do site, existe uma **extensão de Chrome** (pasta `chrome-extension/`, não faz parte do
deploy do Vercel) com um popup replicando ÍNDICES (5 principais), SINGLE NAMES e BUSCA — ver
seção 21. **Não foi atualizada desde então** (ETFs Internos, CNBC/NOTÍCIAS, remoção de BUSCAR) —
se quiserem isso refletido na extensão também, é trabalho novo.

---

## 2. Arquitetura de Arquivos

```
/
├── index.html                     # Aplicação completa (HTML + CSS + JS embutidos)
├── package.json                   # { "type": "module" } — OBRIGATÓRIO pro Vercel (ver seção 19); tem dependência `ws` (seção 6.1.1)
├── vercel.json                    # Configuração de deploy no Vercel
├── favicon.ico                    # Favicon (16px + 32px, PNG-in-ICO)
├── server.ps1                     # Servidor local de desenvolvimento (PowerShell)
├── vercel-usage.ps1                # Script local p/ monitorar uso/custo do Vercel via API
├── launch.json                    # Config do preview server do Claude Code (autoPort: true)
├── METODOLOGIA.md                 # Este arquivo — visão geral de todo o terminal
├── SIMULADOR_METODOLOGIA.md       # [HISTÓRICO] fórmulas do Simulador — aba removida, feature não existe mais
├── Bonds Carteira.xlsx            # [ÓRFÃO] planilha do usuário — fonte da extinta aba BONDS, sem uso agora
├── assets/                        # Logo/favicon fonte
│   ├── icon.svg                  # Logo vetor (linha de gráfico laranja)
│   ├── icon-16.png, icon-32.png, icon-192.png, icon-512.png
├── chrome-extension/               # Extensão de Chrome — NÃO faz parte do deploy Vercel
│   ├── manifest.json             # Manifest V3
│   ├── popup.html / popup.js
│   ├── icons/                    # ícones próprios (16/32/48/128px)
│   └── README.md                 # passo a passo de instalação
└── api/                            # exatamente 9 arquivos — ver seção 19.1.1 sobre o teto de 12 do Hobby
    ├── yahoo.js                   # Proxy Yahoo Finance v8 chart (preço + histórico) — aceita &interval= (ver 6.2)
    ├── target.js                  # Proxy Yahoo Finance quoteSummary (price targets — crumb auth)
    ├── quote-search.js            # Resolve texto livre → ticker(s) candidato(s) (busca do Yahoo) — usado pela busca de ativos em SINGLE NAMES
    ├── anbima.js                  # Proxy ANBIMA ETTJ (POST)
    ├── b3.js                      # Cotação B3 (fallback TradingView) + histórico DI Futuro (fundido com o ex di-history.js — seção 6.1.1, usa o pacote `ws`). ?s=X → cotação; ?s=X&history=1 → histórico
    ├── ecb.js                     # Proxy ECB taxa de juros
    ├── ntnb.js                    # Snapshot + histórico NTN-B (fundido com o ex ntnb-history.js — seção 8.2). Sem ?days → snapshot; ?days=N → histórico
    ├── news.js                    # Notícias por ticker (lupa 🔍 dos Single Names) + resumo por IA (fundido com o ex summarize-news.js). Sem ?action → lista por ticker; ?action=summarize&url=...&title=... → resumo Gemini
    └── ai-news.js                 # Aba NOTÍCIAS: recorte por palavra-chave sobre várias fontes, Nacional/Internacional/Top Picks, nota de relevância (seção 15.1)
```

`api/cnbc-news.js` foi apagado na remoção da aba CNBC (seção 0/15). `api/bonds.js`,
`api/bonds-history.js` e `api/summary.js` (órfão do OpenAI) **foram apagados**
(remoção da aba BONDS na seção 0/16, e o `summary.js` órfão em algum momento anterior — não está
mais no repo). `api/di-history.js`, `api/ntnb-history.js` e `api/summarize-news.js` **foram
fundidos nos arquivos acima** nessa mesma sessão, pelo motivo descrito na seção 19.1.1 (limite de
12 funções do plano Hobby).

Arquivos na raiz que **não pertencem ao site em produção**: `CONTEXT.md`, `terminal-financeiro.html`,
`PLANEJAMENTO APP PROJETO.md`, `Terminal financeiro logo.zip`, `Terminal-Financeiro-Extensao.zip`,
`Thumbs.db`, `Bonds Carteira.xlsx` (órfã desde a remoção da aba Bonds).

**Regra de ouro:** tudo em `api/` roda server-side no Vercel. O `server.ps1` replica esses mesmos
endpoints localmente. O navegador nunca chama APIs externas diretamente (exceto BCB, que é
chamado direto do browser — ver seção 6.1).

**Regra de ouro nº 2:** todo arquivo em `api/*.js` usa sintaxe **ES Module** (`export default
async function handler(...)`) — nunca `module.exports`. O `package.json` na raiz declara
`"type": "module"`, exigido pelo Vercel. Misturar os dois formatos quebra **todas** as funções
serverless de uma vez — já aconteceu antes, ver seção 18.1.

---

## 3. Desenvolvimento Local

```powershell
.\server.ps1
```

`server.ps1` é um `HttpListener` do .NET que serve `index.html` (e qualquer outro arquivo
estático do projeto) e replica cada rota de `api/*.js` sequencialmente. Notas de manutenção:

- **Porta**: lê `$env:PORT` se definida (fallback pra 3000).
- **`$res.KeepAlive = $false`** no topo do loop — sem isso, o listener trava depois de muitas
  requisições seguidas.
- **Content-Type de arquivos estáticos**: `.svg`→`image/svg+xml`, `.png`→`image/png`,
  `.ico`→`image/x-icon`.
- Todas as rotas usam `try/catch` e retornam JSON de erro consistente (`{"error": "..."}`).
- **PowerShell não recarrega o script sozinho**: qualquer mudança nas rotas de `api/*` dentro de
  `server.ps1` exige reiniciar o processo (`preview_stop` + `preview_start`).
- **Variáveis de ambiente locais necessárias** (definir antes de iniciar, na mesma sessão de
  shell — não persiste entre reinícios do terminal):
  ```powershell
  $env:GEMINI_API_KEY = "sua_chave"
  ```
- **Bug de encoding conhecido (só local, não afeta produção)**: `[System.Net.WebClient]`
  sem `$wc.Encoding = [System.Text.Encoding]::UTF8` explícito corrompe acentos de texto
  vindo de fontes externas em UTF-8 (ex: nomes com acento nas respostas da CNBC).
  **Sempre setar essa linha em qualquer novo `WebClient` que busque texto
  com acentuação.** A função do Vercel (Node/`fetch`) nunca teve esse problema.

---

## 4. Design System (CSS)

### Variáveis de cor
```css
--bg: #08080f; --bg-card: #0c0c18; --border: #181828; --border-hi: #252540;
--orange: #ff6600; --green: #00cc77; --red: #ff3344;
--text: #a8b4cc; --dim: #485068; --bright: #dde4f8;
```
Fonte: `'Courier New', Consolas, Monaco, monospace` em todo o terminal.

### Logo e favicon
Logo própria (`assets/icon.svg`) no cabeçalho e no popup da extensão. Favicon `.ico` real
(16px+32px, PNG-in-ICO) na raiz do domínio.

### Responsividade mobile
Bloco `@media (max-width: 640px)` no final do CSS, aditivo — grid principal → 1 coluna, header
empilha, gráficos reduzem altura, modal ocupa 95vw.

### Classes utilitárias principais
| Classe | Uso |
|---|---|
| `.pos` / `.neg` / `.hl` / `.dim2` / `.err` | cores semânticas |
| `.row` | linha de métrica genérica (Índices, Busca, Single Names, ETFs) |
| `.row-click` | linha/elemento clicável — abre modal de gráfico ou popup |
| `.lock` | indicador 🔒 de mercado fechado |
| `.sn-search-btn` | botão de lupa 🔍 nas células de Single Names |
| `.sources-link` | texto clicável tipo "fontes"/"consolidado"/"atualizar" (abre modal ou recarrega) |
| `.etf-disclaimer` | banner de aviso reaproveitado em ETFs Internos, NTN-B e CNBC |
| `.heatmap-*` | classes do Heatmap (seção 10) |
| `.cnbc-hero-*` / `.cnbc-secondary-*` | pacote de destaque da aba CNBC (seção 15) |
| `.modal-overlay` / `.modal-box` | modais genéricos — cada feature tem seu próprio `#id-overlay` |

---

## 5. Sistema de Cache

```javascript
function cacheGet(k) { return JSON.parse(localStorage.getItem('tf_' + k)) }
function cachePut(k, v) { localStorage.setItem('tf_' + k, JSON.stringify(v)) }
```

Cada valor cacheado via `yahoo(ticker)` inclui `fetchedAt: Date.now()`. Usado pelo Heatmap pra
saber se um valor em cache ainda é "fresco" (< 90s).

**CNBC e busca de ativos/notícias não usam esse cache** — são ações on-demand (clique pra
rodar/atualizar), fora do ciclo de 60s do `loadAll()`.

---

## 6. Fontes de Dados por Card (aba ÍNDICES)

### 6.1 Card Brasil
CDI 12M e Selic via BCB (chamada direta do browser); Ibovespa via Yahoo (`^BVSP`); DI Futuro
JAN/30 e JAN/35 via B3 **com fallback pro ADVFN** (ver 6.1.1); ETTJ Pré/IPCA/Inflação Implícita
252du via ANBIMA (`/api/anbima`).

**Bug corrigido (Selic)**: a API do BCB retorna `{"erro":{}}` pra série 432 quando usado
`?formato=json`. Sem esse parâmetro funciona.

#### 6.1.1 DI Futuro — fallback quando a B3 cai (nova feature dessa sessão)
A B3 (`cotacao.b3.com.br`) já ficou fora do ar por completo nessa sessão — confirmado testando
até a raiz do domínio, que devolvia HTTP 520 (erro de origem do Cloudflare), não só o endpoint
específico do DI. `api/b3.js` agora tenta a B3 primeiro e, se falhar, cai pro **scanner do
TradingView** (`POST scanner.tradingview.com/global/scan`, endpoint interno não documentado,
mas estável). Resposta inclui `source: 'b3'|'tradingview'`; o front-end mostra "· via
TradingView (B3 fora do ar)" no sub quando usa o fallback.

**Duas pegadinhas reais descobertas testando esse endpoint**:
1. `/brazil/scan` (o mais óbvio de tentar, dado o país) devolve sempre `{"totalCount":0,"data":[]}`
   pra contratos futuros — só cobre ações. **O endpoint certo é `/global/scan`.**
2. Símbolo do TradingView usa **ano com 4 dígitos** (`DI1F2030`), diferente do formato da B3/ADVFN
   (`DI1F30`, 2 dígitos) — conversão simples: insere `"20"` antes dos 2 dígitos finais do ano
   (`symbol.replace(/(\d{2})$/, '20$1')`).

Dado atualizado tem ~15min de delay (`update_mode: "delayed_streaming_900"` na resposta bruta,
não exposto pelo nosso proxy). Testado e confirmado funcionando **tanto via `curl` quanto via
PowerShell (`Invoke-WebRequest`)** — ao contrário do ADVFN (tentativa anterior, descartada — ver
abaixo), esse endpoint não tem bloqueio por fingerprint de TLS, então funciona igual em
`server.ps1` (dev local) e no Vercel.

**Histórico do gráfico de linha do tempo — evolução completa nessa mesma sessão**: essa parte
passou por três fontes diferentes até chegar na versão final:

1. **Tentativa 1 — ADVFN (scraping HTML)**: `br.advfn.com/bolsa-de-valores/bmf/{symbol}/cotacao`
   pro preço, e `/historico` (tabela em base64 no atributo `data-options`) pro gráfico. Funcionava
   via `curl`, mas **`[System.Net.WebClient]` e `Invoke-WebRequest` do PowerShell eram bloqueados
   com HTTP 403** pela Cloudflare da ADVFN — não era o header `User-Agent` (testado idêntico ao do
   curl que passava), e sim o fingerprint de TLS do .NET Framework que a Cloudflare reconhece.
   Testável só via curl, não via `server.ps1`. Além disso, a tabela de histórico da ADVFN sempre
   devolvia os mesmos ~64 dias fixos (≈3 meses), ignorando qualquer parâmetro de range.
2. **Tentativa 2 — TradingView scanner só pro preço**: resolveu o preço (seção acima), mas
   **quando testado em produção, o endpoint de histórico baseado em ADVFN também deu 403** — ou
   seja, a Cloudflare da ADVFN bloqueia o Vercel também, não só o PowerShell local. Nesse ponto o
   gráfico ficou sem fonte viável nenhuma.
3. **Tentativa 3 (final) — protocolo WebSocket do TradingView**: o scanner REST
   (`/global/scan`) não expõe histórico, só cotação atual. Pra histórico, o TradingView só
   disponibiliza via um protocolo de streaming em `wss://data.tradingview.com/socket.io/websocket`
   — não documentado publicamente, mas validado manualmente com um cliente de teste antes de
   implementar. Sequência de comandos: `set_auth_token` → `chart_create_session` →
   `resolve_symbol` → `create_series` (pedindo N barras diárias); resposta chega em
   `timescale_update`, com pontos em `p[1][seriesId].s[].v = [timestamp, open, high, low, close,
   volume]`. Pedir **500 barras diárias já cobre ~2 anos de histórico** (bem mais que os ~3 meses
   fixos da ADVFN) — por isso o modal agora oferece **1M / 3M / 6M / 1A / 2A**, igual ao NTN-B.

   **Duas pegadinhas do protocolo WebSocket**:
   - Mensagens trafegam envelopadas em `~m~<tamanho>~m~<conteúdo>`; o servidor manda heartbeats
     nesse mesmo formato como `~h~<n>`, que **precisam ser ecoados de volta** ou a conexão cai.
   - `ReceiveAsync`/`ws.on('message')` podem devolver uma mensagem **fragmentada em vários
     pedaços** — só tratar como completa quando o frame de fechamento de mensagem chegar
     (`EndOfMessage` no .NET, ou o evento de mensagem completa no `ws` do Node). No `server.ps1`,
     esse foi um bug real encontrado e corrigido: sem acumular os fragmentos num buffer até
     `EndOfMessage=true`, o `timescale_update` (mensagem grande, 500 barras) chegava cortado e o
     parser descartava o resto silenciosamente, nunca completando.

   Implementação: `api/b3.js` (rota `?s=X&history=1` — fundida com o antigo `di-history.js`,
   ver seção 19.1.1) usa o pacote npm `ws` (adicionado em `package.json` — **primeira
   dependência externa do projeto**, então `package.json` também precisa ser subido junto se
   ainda não tiver ido). `server.ps1` usa `System.Net.WebSockets.ClientWebSocket` (.NET
   Framework 4.5+) pro mesmo protocolo — **testado e funcionando local também**, ao contrário
   da tentativa com ADVFN.

O front-end busca o histórico completo (~2 anos) uma vez por símbolo e fatia localmente pro range
escolhido, sem repetir a chamada a cada clique de botão — mesmo padrão de antes, só que agora com
dado suficiente pra cobrir todas as janelas oferecidas de verdade (nenhuma janela mostra menos
dado do que o rótulo promete).

### 6.2 Card Bolsa US
`^GSPC`, `^SPXEW`, `^DJI`, `^IXIC` + pré-mercado `YM=F`, `ES=F`, `NQ=F`.

**`/api/yahoo` aceita `&interval=`** (adicionado nessa sessão pra suportar candles intraday de
5 minutos usados pela aba ETFs Internos — ver seção 13.4). Antes era fixo em `interval=1d`.
Default continua `1d` se omitido, então nada quebrou nas chamadas já existentes.

### 6.3 Card Europa + Emerging Markets
`^STOXX50E`, `^GDAXI` + `EEM` (ETF, não o índice bruto — problemas de dados no Yahoo).

### 6.4 Card Ásia & Pacífico
`^N225` (Nikkei), `^HSI` (Hang Seng), **`^KS11` (KOSPI — adicionado nessa sessão)**, `^NSEI`
(Nifty 50), `^AXJO` (ASX 200).

### 6.5 Card Juros Globais
Fed Funds Rate (`^IRX`), Taxa BCE (`/api/ecb`), T-Note 10 Anos (`^TNX`).

### 6.6 Card Commodities & Cripto
`BZ=F`, `CL=F`, `GC=F`, `BTC-USD`.

### 6.7 Card NTN-B (full-width) — **agora com histórico** (nova feature, seção 8.2)
Snapshot do dia via arquivo texto diário da ANBIMA (`/api/ntnb`), vencimentos 2028-2045. Cada
célula agora é **clicável** e o cabeçalho tem um link "📈 consolidado" — ver seção 8.2 pra a
feature completa de histórico.

---

## 7. Indicador de Mercado Fechado (🔒)

Usa `meta.currentTradingPeriod.regular` do Yahoo (`{start, end}` em epoch seconds):
```javascript
const ctp = m.currentTradingPeriod?.regular;
const marketOpen = ctp ? (Date.now()/1000 >= ctp.start && Date.now()/1000 <= ctp.end) : null;
```
`renderMkt()` popula `<span class="lock" id="{prefix}-lock">` (convenção: `{prefix}-val` →
`{prefix}-lock`). Bitcoin nunca mostra cadeado. `/api/yahoo` usa `includePrePost=false`.

---

## 8. Modal de Gráfico Individual + Seleção Manual de Intervalo

### 8.1 Modal básico (clique em qualquer ativo)
`openChart(ticker, name)` abre modal com Chart.js, janelas **1M/3M/YTD/1A/5A** + **"DESDE O
INÍCIO"** pra Single Names (ver `SINGLES_ENTRY_DATES`). Guarda contra race condition ao trocar
de ativo/janela rápido. `fmtEntryDate(dateStr)` evita bug de fuso horário (nunca usar
`new Date(dateStr).getDate()` pra formatar uma data ISO como rótulo — volta um dia).

**Preço de entrada manual**: `SINGLES_ENTRY_PRICE_OVERRIDES` permite forçar um preço de entrada
específico (ex: operação feita no mesmo dia, antes do fechamento aparecer no histórico do Yahoo)
em vez de depender do fechamento oficial da série.

### 8.2 NTN-B · Histórico/Consolidado (feature nova dessa sessão)
Cada célula NTN-B agora é clicável (`openNtnbHistory(year)`) e mostra o histórico **daquele
vencimento específico** num modal dedicado (linha única, com valor atual e variação em p.p. no
período). O link **"📈 consolidado"** no cabeçalho do card (`openNtnbHistory()` sem argumento)
mostra as **6 curvas juntas** pra comparação.

Janelas: **5D / 1M / 3M / 6M / 1A**. Backend: `/api/ntnb-history?days=N` busca o arquivo diário
da ANBIMA pra cada pregão do período, em paralelo.

**Limitação real e importante**: a ANBIMA só retém ~5-6 meses de arquivo diário nesse endpoint
público (confirmado testando datas específicas — arquivos de fevereiro/2026 já retornavam 404 em
julho/2026). Pedir "1A" não quebra, mas devolve só o que existe. Pra não estourar o tempo da
função serverless em janelas grandes, o backend faz **amostragem** (1 em cada N dias, mantendo
≤90 requisições no pior caso) em vez de buscar todo dia útil — `MAX_SAMPLES = 90` em
`api/ntnb.js` (rota `?days=N` — fundida com o antigo `ntnb-history.js`, ver seção 19.1.1).
Janelas pequenas (5D/1M/3M) sempre saem em resolução diária completa.

**Removemos um contador de "X pregões · data a data"** que tinha sido adicionado pra
transparência — o usuário achou que sobrecarregava visualmente o gráfico, então voltamos pro
comportamento mais limpo (só o gráfico, sem essa legenda extra).

### 8.3 Seleção manual de intervalo (clicar e arrastar, estilo Google Finance)
Plugin genérico do Chart.js (`dragRangePlugin`, registrado globalmente em `Chart.register(...)`),
ativado por gráfico via `plugins: { dragRange: { enabled: true } }` na config. Clicar e arrastar
sobre qualquer gráfico habilitado desenha uma área sombreada + linhas verticais tracejadas + uma
caixa flutuante com a variação absoluta e percentual entre os dois pontos — pra **cada dataset
visível** (útil no gráfico de Portfólio, que tem várias linhas simultâneas).

**Gráficos com o plugin ativado**: modal individual (`modal-chart`, ambas variantes normal e
"Desde o Início"), Portfólio (`pf-line-chart`), ETFs Internos (`etf-*-chart`), NTN-B histórico
(`ntnb-history-chart`), DI Futuro histórico (`di-history-chart` — seção 6.1.1). **Não ativado**
no scatter de Risco×Retorno do Portfólio — ali o eixo X é risco, não tempo, então "arrastar por
data" não faz sentido.

**Bug real corrigido ao implementar isso**: por padrão o Chart.js só escuta os eventos
`mousemove, mouseout, click, touchstart, touchmove` — `mousedown`/`mouseup` **não estão na lista
padrão**. Precisa declarar explicitamente em cada gráfico:
```javascript
events: ['mousedown', 'mousemove', 'mouseup', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'],
```
Sem isso o plugin nunca recebe o `mousedown` inicial e a seleção simplesmente não funciona (sem
erro nenhum — só não faz nada). Se adicionar o plugin a um gráfico novo e a seleção não
funcionar, **checar isso primeiro**.

---

## 9. Aba SINGLE NAMES

Grid 5×2 de equities (composição evolui — ver `SINGLES` no código pra lista atual; não citar
tickers em documentação). Cada célula mostra preço, variação, price target de analistas (via
`/api/target.js`) quando disponível (ETFs na lista não têm price target — tratado com
`d?.targetMean` guard, sem crash).

### 9.1 Gráfico e busca por ativo
Mesmo modal da seção 8. Botão de lupa (`.sn-search-btn`) abre notícias específicas daquele ativo.

---

## 10. Aba HEATMAP

Treemap visual, 5 grupos: Single Names Portfolio, Bolsa US, Índices Futuros, **Europa + Ásia +
Emerging Markets (agora com KOSPI)**, Commodities e Cripto.

### 10.1 Algoritmo
Squarified treemap próprio (`computeTreemap`). **Não voltar pra divisão binária simples**
(slice-and-dice) — produzia tiras finas e feias.

### 10.2 Correção de tamanho (bug real corrigido nessa sessão)
Tamanho do bloco era proporcional direto a `|chg|` (piso 0.15) — quando um grupo tinha ativos com
variações muito desiguais na mesma "linha" do algoritmo squarified (ex: um ativo com -0,5% ao
lado de outros com ±7%), o menor virava uma célula degenerada (ex: 3% de largura, texto
ilegível). **Corrigido aplicando raiz quadrada no valor de tamanho**:
```javascript
const items = group.data.map(d => ({ ...d, value: Math.sqrt(Math.max(Math.abs(d.chg) || 0, 0.15)) }));
```
Isso comprime a disparidade entre variações grandes e pequenas sem perder a hierarquia visual.
**Se um heatmap novo tiver células ilegíveis, aplicar a mesma raiz quadrada.**

### 10.3 Cor e cache
Cor por `heatColor(chg)` (verde/vermelho por intensidade). Cabeçalho de grupo = média aritmética
simples. Reaproveita cache do ciclo de 60s (`fetchedAt` < 90s).

---

## 11. Aba PORTFÓLIO

Simulador equal-weight dos Single Names. Janelas 3M/6M/YTD/1A/2A.

- **Desempenho Relativo · base 100**: linha do portfólio + linha pontilhada do S&P 500
  (benchmark). Seleção manual de intervalo habilitada (seção 8.3).
- **Risco × Retorno · Sharpe**: scatter, sem seleção manual (eixo X é risco).
- Retorno via `calcStats(prices)` — **CAGR/composto**, diferente do que os ETFs Internos e o
  Simulador (removido) usavam (média aritmética) — não comparar os números diretamente entre
  abas diferentes.

---

## 12. [REMOVIDO] Aba SIMULADOR — Fronteira Eficiente de Markowitz

**Essa aba foi completamente removida nessa sessão**, a pedido explícito do usuário ("retire a
aba de simulador, por favor"). Foram apagados: o botão de navegação, o painel HTML inteiro, todas
as ~30 funções JS com prefixo `mk` (`mkCalculate`, `mkAlignSeries`, `mkEnforceLongOnly`,
`mkTangencyPortfolio`, etc.), todo o CSS `.mk-*` (~50 linhas), e a seção correspondente no modal
de Fontes.

**`SIMULADOR_METODOLOGIA.md` continua no repo**, documentando a matemática exata (otimização por
álgebra de matrizes, restrição peso ≥ 0 via método de conjunto ativo, etc.) — é só histórico
agora. **Não recriar essa aba sem que o usuário peça de novo explicitamente.**

Se precisar entender por que uma decisão antiga menciona "o Simulador fazia X" em algum commit ou
comentário de código remanescente, é sobre essa feature que não existe mais.

---

## 13. Aba ETFS INTERNOS

Dois ETFs sintéticos ("montados por nós", não produtos negociáveis reais):
- **🖥️ Equipamento IA ETF** — fabricantes de equipamento de litografia/produção de chips.
- **🧠 Memória IA ETF** — fabricantes de chips de memória.

Cada holding tem um peso fixo (`ETFS` constant no JS). O índice ponderado (base 100) é calculado
a partir do retorno % de cada ativo — **a moeda de cotação não afeta o cálculo**, só o retorno
percentual entra.

### 13.1 Papéis originais, não ADRs
Por pedido explícito do usuário ("não use ADRs... use os papéis originais, já que têm mais
liquidez e track record"), vários holdings usam o ticker da bolsa de origem em vez do ADR
americano:
- ASML → **revertido pro ADR `ASML` da Nasdaq (USD)** a pedido do usuário nessa sessão — antes usava
  `ASML.AS` (Euronext Amsterdam, EUR); deixou de ser exceção, agora é ação nativa em USD como os
  outros papéis americanos da lista
- Tokyo Electron → `8035.T` (Tokyo Stock Exchange, JPY)
- SK Hynix → `000660.KS` (Korea Exchange, KRW) em vez do ADR (que só passou a existir na Nasdaq
  em julho/2026 e tem histórico curto)
- Kioxia → `285A.T` (Tokyo Stock Exchange, JPY)
- Samsung Electronics → `005930.KS` (Korea Exchange, KRW) — **nunca teve ADR líquido**; o
  ADR não-patrocinado `SSNLF` (OTC Pink Sheets) foi testado e descartado por ilíquido
  (só 1 dia com volume real nos últimos 60 pregões — preço ficava "congelado").
- Applied Materials, Lam Research, KLA, Micron, SanDisk já eram ações americanas nativas
  (sem ADR envolvido) — não mudaram.

Cada holding com `priceCcy` diferente de USD tem uma nota explicativa (`note`) na interface.

### 13.2 Alinhamento por dia calendário (bug real corrigido)
Misturar ativos de bolsas em fusos horários diferentes (ex: Coreia + EUA) usando **timestamp
exato** faz um ativo "entrar e sair" do índice a cada dia (os pregões nunca coincidem
exatamente), criando um serrilhado artificial no gráfico. **Corrigido alinhando por dia
calendário** (`YYYY-MM-DD`, UTC), não por timestamp bruto — mesma técnica documentada
originalmente pro Simulador (removido) ao misturar B3+NASDAQ.

### 13.3 Peso redistribuído pra ativos recém-listados
Quando um ativo tem histórico mais curto que os outros (ex: SK Hynix ADR só desde jul/2026, antes
da troca pro ticker local), o índice não colapsa pra janela mínima — cada ativo entra a partir da
sua própria primeira data disponível, redistribuindo o peso dos ausentes entre os presentes
naquele dia (igual um índice real trata a entrada de um novo constituinte).

### 13.4 Modo INTRADIA
Botão "INTRADIA" busca candles de 5 minutos (`&interval=5m` em `/api/yahoo`) pro pregão mais
recente de cada ativo — o Yahoo já devolve automaticamente a última sessão disponível daquela
bolsa específica (aberta agora ou já fechada), resolvendo sozinho o problema de bolsas em fusos
diferentes estarem fechadas no momento da consulta.

O índice combinado usa uma linha do tempo absoluta (fuso do navegador do usuário): ativos de
bolsas **já fechadas** ficam com o preço "congelado" (último conhecido) contribuindo normalmente,
enquanto bolsas ainda abertas continuam atualizando — mesma lógica de peso da seção 13.3, mas
"congelando" em vez de excluir. Indicador 🔒 na lista de holdings mostra qual bolsa está fechada.

### 13.5 Retorno da janela por holding + seleção manual
Cada holding mostra sua própria variação % na janela selecionada (calculada do histórico já
buscado, sem chamada extra). Seleção manual de intervalo habilitada nos gráficos de índice
(seção 8.3).

---

## 14. [REMOVIDO] Aba BUSCAR

**Removida numa sessão posterior**, junto com a aba CNBC (seção 15), a pedido do usuário. Tinha
sub-abas NOTÍCIAS (busca livre + feed do mercado americano via `/api/news`, apagada de vez) e
ATIVOS (resolve texto em ticker via `/api/quote-search`) — a sub-aba ATIVOS foi **preservada e
movida pra dentro da aba SINGLE NAMES** (mesmo `runAssetSearch()`, só trocou de card). O endpoint
`/api/news` continua existindo — ainda usado pelo botão de lupa 🔍 dos Single Names
(`openTickerNews`) e pelo "resumir com IA" (`action=summarize`, ver histórico abaixo), só não
tem mais o card de feed genérico de notícias do mercado americano.

**Resumo por IA sob demanda** (`/api/news?action=summarize&url=...&title=...` — fundido no
`api/news.js`, era `api/summarize-news.js` separado, ver seção 19.1.1): busca o HTML do artigo,
extrai texto via regex, manda pro Gemini (`gemini-2.5-flash`, free tier, 5 req/min). Reaproveitado
pela aba NOTÍCIAS (seção 15.1) — mesmo endpoint, mesmo botão "🤖 resumir com IA".

---

## 15. [REMOVIDO] Aba CNBC (BETA)

**Removida numa sessão posterior**, a pedido do usuário — "CNBC não faz sentido, já temos o
portal na parte de notícias" (a fonte CNBC já está coberta dentro do recorte por palavra-chave
da aba NOTÍCIAS, seção 15.1, então a aba dedicada ficou redundante). Agregava manchetes via RSS
oficial da CNBC (7 feeds: Top News, World, Markets, Technology, Finance, Economy, Energy), com
um pacote de destaque (hero + 2 secundários, raspando a home `cnbc.com/world`) igual ao layout
real do site. Apagados: botão de navegação, painel HTML, JS (`loadCnbc`, `filterCnbc`,
`renderCnbcList`, `renderCnbcTopStory`), CSS `.cnbc-*`, o arquivo `api/cnbc-news.js` e a função
`Get-CnbcTopStory` + rota espelhada em `server.ps1`. **Não recriar sem pedido explícito.**

---

## 15.1 Aba NOTÍCIAS

Aba nova dessa sessão — **nome final é "NOTÍCIAS"** (começou como "IA & CHIPS (BETA)", só IA/
chips; o usuário ampliou a lista de palavras-chave pra cobrir mercado financeiro/política/
geopolítica/economia em geral no meio da sessão, e por isso pediu o rename — deixa de ser um
recorte de nicho e vira o feed geral do terminal). Internamente os IDs/nomes de função ainda
usam `ainews`/`aiNews*` (não renomeados, só a label visível) — não confundir com a aba BUSCAR
(que também tem uma sub-aba chamada "NOTÍCIAS", é outra coisa, ver seção 14). Duas sub-abas:
**NACIONAL** e **INTERNACIONAL**.

### 15.1.1 Origem — reciclado de um scraper Python que o usuário já tinha
O Daniel já tinha um agregador de notícias em Python rodando fora do terminal
(`Novo Projeto/newsterm/{sources,fetcher}.py`, projeto separado, não faz parte do deploy do
Vercel). Pediu explicitamente pra reciclar essa metodologia em vez de reinventar — `api/ai-news.js`
é uma reimplementação em JS (Node/Vercel) da mesma lógica:
- **Mesmas 6 fontes**: G1, CNBC, Reuters, Brazil Journal, InfoMoney, Investing.com.
- **Reuters via Google News** (`news.google.com/rss/search?q=site:reuters.com+when:2d&hl=en-US...`)
  em vez de RSS direto — a Reuters bloqueia scraping direto (proteção DataDome) e não tem mais
  RSS público próprio.
- **Paginação WordPress** (`?paged=N`) pra Brazil Journal (4 páginas) e InfoMoney (5 páginas) —
  esses sites publicam bastante e a primeira página do feed sozinha traria pouca coisa.
- **Limpeza de título**: corta sufixo "- NomeDaFonte" e "by NomeDaFonte" (comum em agregadores
  tipo Google News), remove rodapé "The post X appeared first on Y" (comum em feeds
  WordPress/Jetpack).
- **Filtro de "lixo"**: descarta títulos que batem em padrões de página de cotação/dado
  financeiro automático (ex: "candlestick chart", "share price today") — comuns no Investing.com,
  que o Google News às vezes indexa junto com notícias de verdade.
- **Deduplicação por link e por título normalizado** — pega tanto matérias já vistas quanto
  espelhos regionais do mesmo site (ex: "Investing.com Nigeria" vs "Investing.com Canada"
  cobrindo a mesma matéria com o mesmo título).

**Diferença em relação ao projeto Python original**: lá a busca por palavra-chave é sob demanda
(o usuário digita um termo, ele consulta o Google News filtrando por aquele termo dentro do
domínio da fonte). Aqui é o oposto — uma **lista fixa de ~370 palavras-chave** (PT+EN, fornecida
pelo usuário, cobrindo IA/chips + mercado financeiro + política + geopolítica + economia) filtra
continuamente tudo que os feeds trazem, sem precisar de busca manual. E aqui existe a separação
Nacional/Internacional, que o projeto Python não tinha (lá as categorias eram por assunto:
Brasil/Mundo/Mercado).

### 15.1.2 Filtro de palavras-chave — duas listas + exigência de 2+ termos
Duas listas fixas em `api/ai-news.js` (espelhadas em `server.ps1` nas variáveis `$AI_KEYWORDS`/
`$AI_EXCLUDE_KEYWORDS`):
- **`KEYWORDS`** (inclusão, ~370 termos): IA/chips ("inteligência artificial", "LLM", "GPU",
  "data center"...), empresas do setor (Nvidia, TSMC, OpenAI, ASML...), mercado financeiro
  (Selic, Ibovespa, IPO, M&A...), política (Congresso, STF, eleições...), geopolítica (Taiwan,
  OPEP, sanções...), economia (PIB, inflação, Copom...). Fornecida pelo usuário, não editar sem
  pedido explícito.
- **`EXCLUDE_KEYWORDS`** (exclusão, ~30 termos): curso, horóscopo, esporte, entretenimento,
  promoção, publicidade etc. — descarta match positivo que caiu em lifestyle/spam.

Mecânica de comparação (igual em JS e PowerShell):
- Normaliza o texto (título + resumo) removendo acentos e colocando em minúsculas (`normalize`
  em JS via `String.normalize('NFD')` + strip de marcas combinantes; `Get-AiNormalizedText` faz
  o equivalente em PowerShell).
- Cada palavra-chave vira um padrão `\bpalavra\b` (fronteira de palavra) — importante pra
  acrônimos curtos tipo "IA"/"GPU" não darem match dentro de outra palavra.
- Se **qualquer** termo de `EXCLUDE_KEYWORDS` bate, descarta na hora, independente do resto.

**Bug de ruído real, investigado com evidência concreta e corrigido nessa sessão**: com "1
palavra-chave batendo já inclui" (implementação original), a lista trazia muita notícia
irrelevante — rastreado caso a caso qual termo causou cada falso positivo:

| Notícia irrelevante | Termo que bateu |
|---|---|
| "Cursos, vagas e seleções... no Pará" | `emprego`, `taxa` |
| Previsão do tempo (umidade do ar) | `queda acentuada` |
| Manutenção de abastecimento de água | `ações` (sentido de "ações legais", não "stocks"), `consumo` (de água, não do consumidor) |
| Abertura simbólica de urnas eleitorais | `invasão` (sentido genérico) |
| Notícia de crime | `investigação`, `retorno` |

Causa: vários termos da lista são palavras genéricas do português com sentido duplo —
`ações`, `consumo`, `retorno`, `taxa`, `intervenção`, `invasão` — que aparecem constantemente em
notícias sem nenhuma relação com o escopo da aba (água, clima, crime, rotina eleitoral local).
**Corrigido exigindo 2+ termos DISTINTOS batendo** (`MIN_KEYWORD_MATCHES = 2` em JS,
`$AI_MIN_KEYWORD_MATCHES` em PowerShell) em vez de só 1 — testado antes/depois: nacional caiu de
85 pra 37 itens no mesmo conjunto de feeds, com o ruído claramente reduzido (mais Trump/tarifas/
STF/eleições relevantes, menos água/clima/crime). **Não elimina 100% do ruído** — dois termos
genéricos ainda podem coincidir por acaso numa notícia irrelevante (ex: "retorno" + "investigação"
numa matéria de Justiça) — mas o volume ficou bem menor. Se quiser apertar mais, subir
`MIN_KEYWORD_MATCHES` pra 3 é a próxima alavanca simples (não pedido ainda).

Também investigado e descartado como bug: no teste inicial, uma notícia do G1 sobre discurso de
campanha política bateu no filtro por "data center" — parecia falso positivo, mas o candidato
genuinamente disse "vamos investir em data center" no discurso. Match real, não bug — é o
esperado de um filtro por palavra-chave amplo.

### 15.1.3 Nacional vs Internacional
Classificação **por fonte**, não por conteúdo do artigo (mais simples e confiável que tentar
detectar "esse texto é sobre o Brasil?" via NLP):
- **Nacional**: G1, Brazil Journal, InfoMoney (fontes brasileiras, majoritariamente em português).
- **Internacional**: CNBC, Reuters, Investing.com (fontes globais/em inglês).

### 15.1.4 Janela de tempo
**72 horas** (`HOURS_WINDOW`/`$windowCutoff`), mais larga que as 24h do CNBC — é um recorte por
tema sobre fontes que também publicam muita coisa fora do tema, então uma janela de 24h deixaria
a lista curta demais na maioria dos dias. Ajustável só nessa constante se quiser mudar.

### 15.1.5 Interface
Reaproveita o mesmo `renderNewsList()` já usado por Busca e CNBC (mesmo botão "🤖 resumir com IA",
via `/api/news?action=summarize`) — nenhuma função de renderização nova precisou ser criada.
Campo de busca por palavra-chave filtra `title`+`summary` do conjunto já carregado (client-side,
sem nova chamada de API), igual ao padrão da CNBC.

**Filtros adicionais (todos client-side, sem nova chamada de API — o backend já traz até 72h de
tudo, os filtros só recortam o que já está na memória)**:
- **Fonte**: chips geradas dinamicamente a partir das fontes que realmente vieram na resposta
  (`renderAiNewsSourceChips()`) — G1/Brazil Journal/InfoMoney em Nacional, CNBC/Reuters/
  Investing.com em Internacional. Multi-seleção (nenhuma marcada = mostra todas). Regenerada
  toda vez que troca Nacional/Internacional, já que as fontes de cada lado são diferentes.
- **Período**: 1H / 6H / 12H / 24H / **24H+** (o último = sem corte, mostra tudo que veio do
  backend, que já é limitado a 72h — ver seção 15.1.4). Single-select, como os outros `range-btn`
  do terminal.
- **Ordenação**: MAIS RECENTES (padrão, desc por `time`) / MAIS ANTIGAS (asc).

Estado em `aiNewsSelectedSources` (Set), `aiNewsPeriodHours` (0 = sem corte) e `aiNewsSortDir`
('desc'/'asc') — todos resetados ao trocar de aba Nacional/Internacional ou recarregar
(`loadAiNews`), exceto o período e a ordenação, que persistem entre trocas de região (só o
filtro de fonte é zerado, porque a lista de fontes disponíveis muda).

---

## 16. [REMOVIDO] Aba BONDS (BETA)

**Essa aba foi completamente removida nessa sessão**, a pedido explícito do usuário ("remova a
parte de bonds do terminal"), depois de uma sequência de tentativas de correção que expuseram um
problema estrutural na fonte de dados. Foram apagados: o botão de navegação, o painel HTML, os
dois modais (histórico de preço e Key Metrics), todo o JS (`loadBonds`, `openBondHistory`,
`openBondMetrics`, `loadBondHistory`, `bondsStore` e variáveis relacionadas), o CSS
`.bond-disclaimer`, os arquivos `api/bonds.js` e `api/bonds-history.js`, e as rotas espelhadas em
`server.ps1`. `Bonds Carteira.xlsx` ficou órfã no repo (era só a fonte manual da lista de ISINs).

**Não recriar essa aba sem que o usuário peça de novo explicitamente** — e se pedir, checar
primeiro se o problema de cota abaixo foi resolvido, senão vai se repetir.

### 16.1 Por que foi removida — histórico da causa raiz
A aba acompanhava preço + yield + duration + G-spread de ~16 bonds em USD da carteira do usuário
(Brasil + África/Ásia/Latam), via API oficial autenticada do **bondterminal.com**
(`GET /api/v1/bonds/{isin}/analytics`, header `Authorization: Bearer <BONDS_API_KEY>`) pra
preço/analytics, e um endpoint público sem autenticação
(`GET /api/bonds/{isin}/market-history?range=`) só pro gráfico de histórico.

A causa raiz do problema final, descoberta passo a passo nessa sessão:
1. A aba começou a dar "ERRO ao carregar bonds" em produção — diagnosticado como
   `BONDTERMINAL_API_KEY não configurada` no Vercel (a variável existia lá, mas salva com outro
   nome: `BONDS_API_KEY`). Corrigido renomeando no código pra bater com o nome real.
2. Depois de corrigir o nome, todos os 16 bonds continuaram falhando. Um campo de diagnóstico
   (`reason`) foi adicionado à resposta da API pra expor o motivo real de cada falha (em vez de só
   "indisponível" genérico).
3. O `reason` revelou **HTTP 429** em 100% dos bonds, com dois motivos distintos misturados:
   `concurrency_limited` ("Too many concurrent requests. Limit: 4 in-flight per API key") e
   `quota_exceeded` ("Daily bond calculation limit reached"). Causa: `api/bonds.js` buscava os 16
   ISINs **todos de uma vez** (`Promise.allSettled` sem limite), estourando o limite de 4
   simultâneas da API bondterminal.com na primeira leva — e cada tentativa falha (com retry de até
   3x por bond) ainda consumia cota da conta.
4. Corrigido um bug real de concorrência: pool limitado a `MAX_CONCURRENCY = 3` requisições
   simultâneas, detecção de `quota_exceeded` pra não insistir em retry inútil, e cache em memória
   de processo (TTL 3 min) pra reduzir chamadas repetidas.
5. **Mesmo depois da correção, a cota diária da chave continuou esgotada** — confirmado via
   `reason: "cota diária do bondterminal.com esgotada"` em todos os 16 bonds, de forma persistente
   entre requisições. Esse é um limite de **conta/plano** no bondterminal.com, não algo que o
   código do terminal pudesse contornar (só esperar reset diário, não documentado publicamente por
   eles, ou negociar aumento de cota/plano com o criador do site). Diante da persistência do
   problema, o usuário optou por remover a aba em vez de continuar dependendo dessa fonte.

**Se algum dia quiserem reativar bonds**: o código removido nessa sessão (pool de concorrência,
cache local com fallback "defasado" — que sempre mostrava a carteira inteira de ISINs mesmo com a
fonte fora do ar, ver histórico de conversas) é um bom ponto de partida técnico, mas só vale a pena
recriar se o problema de cota/plano do bondterminal.com for resolvido primeiro.

**Cobertura da fonte** (pra referência, caso reavaliem essa ou outra fonte de bonds no futuro):
bancos/financials americanos e europeus grandes (JP Morgan, Goldman Sachs, Citigroup, Barclays,
Deutsche Bank, etc.) **não existiam** nem no endpoint autenticado nem no público — o
bondterminal.com é especializado em crédito soberano e corporativo de mercados emergentes, não em
cobertura global de todo tipo de emissor.

---

## 17. Modal de "Fontes & Metodologia"

Texto "fontes" clicável no cabeçalho. Modal (`#sources-overlay`) com resumo condensado de todas
as fontes por seção — inclui CNBC. As seções do Simulador e do Bonds foram **removidas** desse
modal junto com as respectivas abas (seções 12 e 16).

---

## 18. Otimização de Custo do Vercel

Plano **Hobby**: limite de 1M invocações/mês. Auto-refresh (60s) só dispara enquanto uma aba está
aberta e em foco (`visibilitychange` pausa o timer em segundo plano). **CNBC não entra no ciclo
de 60s** — é on-demand (clique pra carregar/atualizar), então não pesa no limite de invocação da
mesma forma que os cards que atualizam automaticamente.

### 18.1 Incidente real: `FUNCTION_INVOCATION_FAILED` (17/07/2026)
Todas as funções falharam simultaneamente com `500`. **Não foi limite de invocação** (usage
estava em ~7%). Causa raiz real: `EnvFileReadError` no runtime do Vercel (falha de
infraestrutura, não de código) — resolvido com **Redeploy** manual. Um problema separado (mistura
CommonJS/ESM em `api/yahoo.js`) coexistiu e também precisou ser corrigido. Lição: se **todas** as
funções falharem de forma idêntica, suspeitar de infraestrutura/config do projeto no Vercel, não
do código — confirmar via **Logs** reais do deployment antes de qualquer suposição.

---

## 19. Deploy

### 19.1 `package.json` é obrigatório
Todo `api/*.js` usa ES Module. `package.json` declara `"type": "module"`. **Nunca** usar
`module.exports` num arquivo novo.

Desde a implementação do histórico de DI Futuro (seção 6.1.1), `package.json` também declara uma
dependência (`ws`, cliente WebSocket) — **primeira dependência externa do projeto**. O Vercel
instala automaticamente via `npm install` no build a partir do `package.json`, mas isso só
funciona se o `package.json` atualizado **estiver de fato no repositório** — se for esquecido
num upload, o build de `api/b3.js` (rota de histórico) falha por não achar o módulo `ws`.

### 19.1.1 Limite de 12 funções serverless no plano Hobby — incidente real e resolvido
O Vercel Hobby limita a **12 Serverless Functions por deployment** (1 função = 1 arquivo em
`api/*.js`). Já batemos nesse limite nessa sessão: ao adicionar `api/di-history.js` (a 13ª
função), o build falhou com `"No more than 12 Serverless Functions can be added to a Deployment
on the Hobby plan"` — e o Vercel silenciosamente manteve a **deployment anterior** no ar (sem o
arquivo novo), sem nenhum aviso óbvio pro usuário além do log de build. Causa raiz: `api/bonds.js`
tinha sido apagado localmente na remoção da aba Bonds (seção 16), mas **nunca foi de fato
deletado do repositório no GitHub** (upload de arquivo novo não remove arquivo antigo não
incluído no lote) — ficou como órfão contando pro limite.

**Lição**: se um deploy novo falhar silenciosamente (a função que você acabou de subir continua
dando `NOT_FOUND` mesmo depois de confirmar que o arquivo está no repo), **checar a aba
Deployments do Vercel primeiro** — o deployment mais recente pode estar com status `Error`
enquanto uma versão anterior continua marcada `Production`. Nesses casos, contar quantos arquivos
existem em `api/` e comparar com o limite de 12 (Hobby) é o primeiro diagnóstico a fazer. E
sempre que remover uma aba/feature que tinha arquivo(s) próprio(s) em `api/`, **lembrar de
deletar esses arquivos no GitHub também** (não só localmente) — apagar localmente sem deletar no
repo remoto deixa órfãos que não aparecem em nenhuma lista até estourar esse limite.

**Resolução**: em vez de remover funcionalidade, **fundimos 3 pares de endpoints da mesma fonte
de dados numa função só cada**, liberando 3 slots de margem:
- `api/b3.js` absorveu `api/di-history.js` (`?s=X` → cotação, `?s=X&history=1` → histórico)
- `api/ntnb.js` absorveu `api/ntnb-history.js` (sem `?days` → snapshot, `?days=N` → histórico)
- `api/news.js` absorveu `api/summarize-news.js` (sem `?action` → lista, `?action=summarize` →
  resumo por IA)

Resultado: **9 arquivos em `api/`** (era 12 no limite, agora com 3 de folga). Os três arquivos
absorvidos (`di-history.js`, `ntnb-history.js`, `summarize-news.js`) foram apagados do repo —
**se algum dia reaparecerem órfãos no GitHub por engano** (mesmo problema do `bonds.js`), é o
primeiro lugar a checar antes de assumir que passou de novo do limite. Ao criar uma função nova
no futuro, **considerar primeiro se ela pode virar uma rota dentro de um arquivo já existente da
mesma fonte de dados**, em vez de um arquivo novo — evita reencostar no teto de 12.

### 19.2 Fluxo do Daniel (não é git CLI)
Sobe arquivos manualmente pela interface web do GitHub ("Add files via upload"), que dispara
redeploy automático no Vercel. **Sempre listar exatamente quais arquivos mudaram** ao final de
cada tarefa. A pasta `chrome-extension/` **nunca** vai pro GitHub/Vercel.

### 19.3 Variáveis de ambiente necessárias no Vercel
| Variável | Usada por | Obrigatória? |
|---|---|---|
| `GEMINI_API_KEY` | `api/news.js` (`?action=summarize` — Busca + CNBC) | Sim, pro botão "resumir com IA" |

`BONDS_API_KEY` não é mais usada — pode ser removida do Vercel (Settings → Environment Variables)
já que a aba BONDS (BETA) foi removida (ver seção 16).

---

## 20. Cuidado com Credenciais

Daniel já colou credenciais direto no chat por engano **várias vezes** ao longo do projeto:

1. API key e token pessoal do Vercel (incidentes anteriores).
2. **Nessa sessão**: colou uma chave (`bt_live_...`) pensando ser do bondterminal.com — na
   verdade era uma **chave de produção da Blueticks** (API de WhatsApp, serviço completamente
   diferente, sem relação com o projeto). Foi identificada e o usuário foi orientado a revogá-la
   imediatamente. **Depois**, o usuário trouxe outra chave (também `bt_live_...`, formato
   coincidente) que essa sim era a correta, com contexto/documentação real do criador do site —
   essa segunda foi testada e usada legitimamente (ver seção 16.2).

**Lição**: o prefixo de uma chave (`bt_live_`) não é garantia de qual serviço ela pertence —
sempre testar contra o endpoint esperado antes de assumir, e nunca usar uma credencial sem
confirmar a origem, mesmo que o usuário diga que é de um serviço específico.

Sempre que orientar sobre gerar uma credencial: **reforçar que deve colar só no painel do
provedor ou nas Environment Variables do Vercel, nunca no chat**. Se uma credencial real aparecer
na conversa, tratar como potencialmente exposta — orientar revogar/rotacionar, mesmo que depois
se confirme que era uma chave "seria" a certa (o hábito de nunca colar chave em chat vale sempre,
independente do resultado).

---

## 21. Extensão de Chrome (`chrome-extension/`)

Popup (Manifest V3) com 3 abas: ÍNDICES (5 principais), SINGLE NAMES, BUSCA (sub-abas
Notícias/Ativos). Reaproveita os mesmos endpoints de `api/*.js` do domínio publicado.
**Não foi atualizada** — não reflete ETFs Internos nem CNBC. Se o usuário quiser essas abas na
extensão também, é trabalho novo a partir do que já existe em `index.html`.

**Não faz parte do deploy do Vercel** — instalada manualmente via `chrome://extensions` →
"Carregar sem compactação", apontando pra essa pasta.

**Detalhes importantes**: `popup.js` detecta protocolo (`chrome-extension:` vs `http(s):`) pra
escolher URL absoluta de produção vs relativa. Manifest V3 bloqueia atributos inline
(`onclick` etc.) por CSP — todo `popup.js` usa `addEventListener`, diferente do `index.html` do
site (que usa inline livremente).

---

## 22. Convenções de Código

- IDs seguem `{prefix}-val`, `{prefix}-chg`, `{prefix}-sub`, `{prefix}-lock` — `renderMkt()`
  deriva o lock via `.replace(/-val$/, '-lock')`.
- Toda nova função de API externa precisa de espelho em `server.ps1` **e** em `api/*.js` —
  sincronizados manualmente.
- **Todo arquivo novo em `api/` usa `export default` (ES Module)** — nunca `module.exports`.
- Ao adicionar `WebClient` em `server.ps1` pra buscar texto externo, **sempre** setar
  `$wc.Encoding = [System.Text.Encoding]::UTF8` (ver bug da seção 3).
- Ao adicionar um gráfico novo que deveria ter seleção manual de intervalo, **lembrar de incluir
  `events: [...]` com `mousedown`/`mouseup`** na config do Chart.js (ver seção 8.3) — é o erro
  mais fácil de esquecer e não dá nenhum aviso quando esquecido.
- Ao misturar ativos de bolsas/fusos diferentes num índice ponderado, **alinhar por dia
  calendário** (`toISOString().slice(0,10)`), nunca por timestamp bruto (ver seção 13.2).
- Se um treemap novo tiver células ilegíveis (muito finas), aplicar raiz quadrada no valor de
  tamanho antes de passar pro `computeTreemap` (ver seção 10.2).
- Emojis nos títulos dos cards são decorativos, mantidos por consistência visual.
- Prefira avisos permanentes na tela (`.etf-disclaimer` ou similar) em vez de esconder
  explicações importantes dentro de um modal que exige clique extra.
