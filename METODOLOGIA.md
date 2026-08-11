# Terminal Financeiro — Metodologia e Documentação Técnica

> Documento de handoff completo — suficiente para qualquer sessão nova (Claude ou humano)
> entender o projeto do zero e continuar o trabalho sem perguntar de novo o que já foi decidido.
> **Reescrito 100% nessa sessão** pra refletir uma repaginação completa de design + uma reforma
> grande da aba NOTÍCIAS (fontes, nota de relevância, classificação por assunto, notificações).
> Se você está lendo isso numa conversa nova, **leia até o fim antes de tocar em qualquer código**.

---

## 0. Status Atual (leia isto primeiro)

**Abas do terminal (6, nessa ordem):** ÍNDICES, SINGLE NAMES, PORTFÓLIO, ETFS INTERNOS, HEATMAP,
NOTÍCIAS.

### Repaginação completa de design (essa sessão)
O terminal deixou de ser um "terminal escuro estilo Bloomberg" e virou um **app claro,
profissional, estilo fintech moderna** — mudança de design puro, toda a lógica/JS ficou
**idêntica** (confirmado por diff linha a linha do `<script>` inteiro na hora da migração — só
mudou indentação, cores de gráfico e remoção de emojis dos textos gerados via JS). O usuário deu
um HTML de referência pronto (gerado por ele/outra ferramenta) e pediu pra virar "a nova base do
terminal"; copiamos o arquivo inteiro por cima do `index.html` depois de validar a integridade.

- **Tipografia**: `IBM Plex Sans` (textos/labels) + `IBM Plex Mono` (números, com
  `font-variant-numeric: tabular-nums`) — carregadas via Google Fonts (`<link>` no `<head>`,
  **primeira dependência de rede externa pro CSS/fontes** do projeto; precisa de internet pra
  renderizar com a fonte certa, cai pro fallback do sistema sem internet).
- **Paleta**: header/rodapé em navy escuro (`--ink: #0f172a`), corpo **off-white** (não branco
  puro — ver variáveis exatas na seção 4), acento azul forte (`--accent: #1d4ed8`) em links,
  bordas de foco e no logo.
- **Abas e filtros**: viraram pílulas (`background: var(--ink)` quando ativo, cantos
  arredondados) em vez de texto sublinhado.
- **Emojis decorativos removidos** de textos/labels (bandeiras, ícones de card, 🔒/🤖/⭐/🔔/✕/🔍
  etc. em strings geradas por JS) — mantidos só como texto puro. Frameworks de emoji-como-ícone
  (ex: `.sn-search-btn`, `.modal-close`, `.feed-search-icon`) ficaram com o elemento vazio
  (dependem só do estilo CSS, sem glifo dentro).
- **Cores off-white testadas e ajustadas** a pedido explícito do usuário ("um off white bem
  claro ao invés do branco") — ver seção 4 pros valores exatos usados.
- **Logo nova**: quadrado azul (`--accent`) arredondado com um check/linha branca (`assets/icon.svg`
  novo). **Os favicons PNG (`icon-16.png`, `icon-32.png`, `icon-192.png`, `icon-512.png`) e os
  ícones da extensão de Chrome continuam com o logo ANTIGO (laranja)** — são raster, não dá pra
  regenerar via edição de texto; ficou pendente uma geração de imagem nova se quiserem 100% de
  consistência visual.

### Extensão de Chrome também repaginada
`chrome-extension/popup.html` foi redesenhado pra bater com o novo visual (mesmas variáveis de
cor/fonte, abas em pílula) — ver seção 21. Ícones da extensão continuam antigos (mesma limitação
acima).

### NOTÍCIAS — reforma grande nessa sessão (ver seção 15.1 pra tudo em detalhe)
- **G1 foi pausado** (não removido de vez) — a pedido do usuário: "retire o G1 como fonte, deixe
  a fonte salva". Config comentada em `SOURCES`/`Get-AiNewsSourcesConfig`, pronta pra reativar
  descomentando.
- **Fontes atuais (12, G1 pausado à parte)**: CNBC, Reuters, Brazil Journal, InfoMoney,
  Investing.com, NeoFeed, Poder360, BBC, Valor, WSJ, Bloomberg, Yahoo Finance.
- **NACIONAL/INTERNACIONAL agora é por ASSUNTO da matéria, não pelo veículo que publicou** —
  mudança grande, ver seção 15.1.6.
- **Nota de relevância (1-10)** ganhou um terceiro componente: bônus de +2 por bater em temas
  prioritários do usuário (juros/Fed, mercado de ações US com foco em IA, geopolítica, e os
  próprios Single Names) — seção 15.1.5.
- **Clustering de "mesma notícia, veículos diferentes"** foi reescrito de Jaccard simples pra um
  cosseno ponderado por IDF (TF-IDF-like) — pega bem mais casos de manchetes com redação
  diferente sobre o mesmo fato. Seção 15.1.4.
- **Sistema de notificação (pop-up)** novo — nota ≥ 10 dispara um toast, mesmo fora da aba
  NOTÍCIAS. Seção 15.1.7.
- **"Manchete real"** (headline) agora é raspagem de verdade da homepage de cada fonte, não mais
  o proxy "top 3 do feed RSS" (esse proxy só sobrevive pra WSJ/Bloomberg, cujas homepages
  bloqueiam fetch simples). Seção 15.1.5.
- **Bug real corrigido no Yahoo Finance**: `regularMarketPreviousClose` vem vazio pra futuros de
  commodities (ouro, petróleo) na API de gráfico — o terminal caía num heurístico que dava número
  errado de variação %. Corrigido com fallback via `quoteSummary` autenticado. Ver seção 6.6.1.

**ÍNDICES ganhou uma sub-aba FECHAMENTO** (pílula HOJE/FECHAMENTO logo abaixo do seletor de
abas) — relatório de fechamento de mercado (Δ dia/mês/ano) pros instrumentos que o usuário
acompanha, calculado on-demand sem cron nem storage. `api/anbima.js` ganhou um modo `?dates=`
multi-data (sem gastar slot novo do teto de 12). Ver seção 6.8 pra tudo em detalhe, incluindo dois
bugs de fuso horário reais encontrados e corrigidos antes de publicar (data errada pra mercados
asiáticos e câmbio com um corte ingênuo de epoch, e a suposição errada de que todo instrumento já
fecha às 19h de Brasília — Brent/Ouro/Bitcoin/câmbio negociam depois disso).

**As abas BUSCAR e CNBC (BETA) foram REMOVIDAS** (não pausadas, removidas de vez) a pedido do
usuário — "CNBC não faz sentido, já temos o portal na parte de notícias". A busca de ativos foi
preservada e movida pra dentro de SINGLE NAMES. Ver seções 14 e 15.

**A aba BONDS (BETA) foi REMOVIDA**, por cota diária esgotada persistente na API paga do
bondterminal.com. Ver seção 16 (histórico).

**A aba SIMULADOR (Markowitz) foi REMOVIDA** a pedido do usuário. `SIMULADOR_METODOLOGIA.md`
continua no repo só como registro histórico da matemática. Ver seção 12.

**Pendências / decisões em aberto:**
1. **`GEMINI_API_KEY` precisa estar configurada no Vercel** para o botão "resumir com IA"
   funcionar em produção. Localmente, `$env:GEMINI_API_KEY`.
2. **Otimização de chamadas de API não implementada.** Consolidar múltiplas chamadas de ticker
   do Yahoo Finance numa única função por categoria reduziria invocações no Vercel em ~50%, mas
   o usuário ainda não decidiu se quer. Ver seção 18.
3. **Dados institucionais Reuters/LSEG**: pergunta em aberto de longa data, sem resposta se o
   usuário tem acesso via RDP (funcionaria) ou só Workspace (não funcionaria remotamente).
4. **`api/summary.js`** (resumo diário de IA via OpenAI) é órfão — primeira tentativa, substituída
   pelo resumo por notícia individual via Gemini. **Ainda está no repo** (10 arquivos em `api/`
   no total, não 9 — ver seção 2), só não é chamado pelo front-end. Podia ser removido com
   segurança se quiserem um slot a mais de folga no limite de 12 do Hobby.
5. **NOTÍCIAS depende de fontes de terceiros não controladas por nós** (RSS de vários veículos,
   scraping de homepage pra "manchete real") — pode quebrar/mudar sem aviso. Ver seção 15.1.
6. **Favicons PNG e ícones da extensão de Chrome continuam com o logo antigo** (laranja) — só a
   logo SVG principal (`assets/icon.svg`) foi trocada pra nova (azul). Pendente gerar PNGs novos
   se quiserem 100% de consistência.
7. **Regra importante de conteúdo:** este documento (e qualquer documentação gerada para o
   projeto) **não deve citar os tickers específicos dos Single Names na PROSA explicativa** —
   preferência explícita do usuário. Na prática, os tickers já aparecem inevitavelmente em vários
   trechos técnicos deste documento (arrays de código, listas de palavras-chave) porque já estão
   no próprio código-fonte (`SINGLES`, `PF_TICKERS`, `PRIORITY_KEYWORDS`) — a regra vale sobretudo
   pra não “destacar” a carteira em texto corrido de forma desnecessária.
8. **Cuidado extra com credenciais**: o usuário já colou no chat, por engano, uma API key que
   pensava ser de um serviço mas era de outro completamente diferente (Blueticks/WhatsApp) — ver
   seção 20 antes de orientar sobre qualquer chave nova.
9. **Horário exato de publicação do arquivo diário da ANBIMA (NTN-B) não é conhecido** — só
   sabemos que o prazo de coleta das instituições é 12h; a publicação em si acontece em algum
   momento depois disso, sem SLA público documentado. Ver seção 6.7.

---

## 1. Visão Geral

**Terminal Financeiro** é um dashboard financeiro construído como uma **única página HTML**
(`index.html`) com JavaScript puro, CSS embutido, sem frameworks front-end (só uma dependência de
CDN pro Chart.js e outra pras fontes Google, ver seção 4). Os dados vêm de APIs públicas,
proxiadas por **Vercel Serverless Functions** (`api/`) pra contornar CORS. Uso real: até ~6
pessoas (Daniel + colegas).

Seis abas:
- **ÍNDICES** — painel de mercado global (Brasil, Bolsa US, Europa+Emerging Markets+Câmbio —
  agora com USD/BRL e EUR/USD, Ásia&Pacífico incluindo KOSPI, Juros Globais, Commodities&Cripto,
  NTN-B com histórico)
- **SINGLE NAMES** — 10 equities definidas pelo usuário (composição evolui — ver `SINGLES` /
  `PF_TICKERS` no código pra lista atual), com data(s) de entrada na posição cadastradas, e uma
  **barra de busca de ativos no topo** (herdada da extinta aba BUSCAR — resolve texto livre em
  ticker, mostra cotação com gráfico clicável)
- **PORTFÓLIO** — simulador equal-weight com gráficos de desempenho relativo (vs. benchmark
  S&P 500) e risco×retorno (metodologia completa na seção 11)
- **ETFS INTERNOS** — dois ETFs sintéticos (setor de equipamento e de memória de IA) montados
  internamente, com índice ponderado, modo intraday, e ativos originais (não-ADR, exceto ASML) —
  ver seção 13
- **HEATMAP** — treemap visual estilo mapa de calor, 6 categorias (Single Names, Bolsa US,
  Índices Futuros, Europa+Ásia+EM, Commodities&Cripto)
- **NOTÍCIAS** — recorte por palavra-chave (IA/chips, mercado financeiro, política, geopolítica,
  economia) sobre 12 fontes, classificado em NACIONAL/INTERNACIONAL **por assunto** (não por
  veículo), com nota de relevância (1-10), Top Picks e sistema de notificação pop-up — ver
  seção 15.1

~~**SIMULADOR**~~, ~~**BONDS (BETA)**~~, ~~**BUSCAR**~~ e ~~**CNBC (BETA)**~~ — todas
**removidas** em sessões anteriores/nessa sessão. Ver seções 12, 14, 15 e 16 pro histórico de
cada uma. **Não recriar nenhuma sem pedido explícito do usuário.**

Além do site, existe uma **extensão de Chrome** (pasta `chrome-extension/`, não faz parte do
deploy do Vercel) com um popup replicando ÍNDICES (5 principais), SINGLE NAMES e BUSCA — **também
repaginada nessa sessão** pro novo visual claro (seção 21). Ainda não reflete ETFs Internos nem
NOTÍCIAS — trabalho novo se quiserem isso na extensão.

---

## 2. Arquitetura de Arquivos

```
/
├── index.html                     # Aplicação completa (HTML + CSS + JS embutidos)
├── package.json                   # { "type": "module" } — OBRIGATÓRIO pro Vercel (ver seção 19); tem dependência `ws` (seção 6.1.1)
├── vercel.json                    # Configuração de deploy no Vercel
├── favicon.ico                    # Favicon (16px + 32px, PNG-in-ICO) — logo ANTIGA, não atualizada na repaginação
├── server.ps1                     # Servidor local de desenvolvimento (PowerShell)
├── vercel-usage.ps1                # Script local p/ monitorar uso/custo do Vercel via API
├── launch.json                    # Config do preview server do Claude Code (autoPort: true)
├── METODOLOGIA.md                 # Este arquivo — visão geral de todo o terminal
├── PALAVRAS_CHAVE_NOTICIAS.md     # Lista completa de KEYWORDS/EXCLUDE_KEYWORDS da aba NOTÍCIAS, extraída do código — pode ficar desatualizada se a lista mudar de novo sem regenerar este arquivo
├── SIMULADOR_METODOLOGIA.md       # [HISTÓRICO] fórmulas do Simulador — aba removida, feature não existe mais
├── Bonds Carteira.xlsx            # [ÓRFÃO] planilha do usuário — fonte da extinta aba BONDS, sem uso agora
├── assets/                        # Logo/favicon fonte
│   ├── icon.svg                  # Logo vetor NOVA (quadrado azul arredondado + check branco) — trocada nessa sessão
│   ├── icon-16.png, icon-32.png, icon-192.png, icon-512.png   # PNGs — AINDA COM A LOGO ANTIGA (raster, não regenerado)
├── chrome-extension/               # Extensão de Chrome — NÃO faz parte do deploy Vercel
│   ├── manifest.json             # Manifest V3
│   ├── popup.html                # Redesenhado nessa sessão pro visual claro/IBM Plex — ver seção 21
│   ├── popup.js                   # JS inalterado na repaginação
│   ├── icons/                    # ícones próprios (16/32/48/128px) — AINDA COM A LOGO ANTIGA
│   └── README.md                 # passo a passo de instalação
└── api/                            # 10 arquivos — ver seção 19.1.1 sobre o teto de 12 do Hobby
    ├── yahoo.js                   # Proxy Yahoo Finance v8 chart (preço + histórico). Aceita &interval=. Tem fallback de fechamento anterior pra commodities/futuros (seção 6.6.1)
    ├── target.js                  # Proxy Yahoo Finance quoteSummary (price targets — crumb auth)
    ├── quote-search.js            # Resolve texto livre → ticker(s) candidato(s) — usado pela busca de ativos em SINGLE NAMES
    ├── anbima.js                  # Proxy ANBIMA ETTJ (POST). Sem ?dates= → snapshot do dia; ?dates=DD/MM/YYYY,... → multi-data (relatório de Fechamento, seção 6.8)
    ├── b3.js                      # Cotação B3 (fallback TradingView) + histórico DI Futuro. ?s=X → cotação; ?s=X&history=1 → histórico
    ├── ecb.js                     # Proxy ECB taxa de juros
    ├── ntnb.js                    # Snapshot + histórico NTN-B. Sem ?days → snapshot; ?days=N → histórico
    ├── news.js                    # Notícias por ticker (busca de Single Names) + resumo por IA. Sem ?action → lista por ticker; ?action=summarize&url=...&title=... → resumo Gemini
    ├── ai-news.js                 # Aba NOTÍCIAS: recorte por palavra-chave, 12 fontes, classificação por assunto, nota de relevância — seção 15.1
    └── summary.js                 # [ÓRFÃO] resumo diário via OpenAI, não usado pelo front-end (pendência 4 da seção 0)
```

`api/cnbc-news.js`, `api/bonds.js`, `api/bonds-history.js` **foram apagados** nas remoções das
abas CNBC e BONDS. `api/di-history.js`, `api/ntnb-history.js` e `api/summarize-news.js` **foram
fundidos** em `b3.js`/`ntnb.js`/`news.js` respectivamente, pelo motivo descrito na seção 19.1.1
(limite de 12 funções do plano Hobby).

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

**Regra de ouro nº 3 (nova, aprendida nessa sessão com um bug real — ver seção 22):** toda
mudança em `api/*.js` precisa do espelho equivalente em `server.ps1`, e vice-versa. Os dois times
de código implementam a MESMA lógica em linguagens diferentes (JS/Node no Vercel, PowerShell
local) — divergência entre eles já causou bugs sutis que só apareciam num dos dois ambientes.

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
  `server.ps1` exige reiniciar o processo.
- **Variáveis de ambiente locais necessárias** (definir antes de iniciar, na mesma sessão de
  shell — não persiste entre reinícios do terminal):
  ```powershell
  $env:GEMINI_API_KEY = "sua_chave"
  ```
- **Bug de encoding conhecido (só local, não afeta produção)**: `[System.Net.WebClient]`
  sem `$wc.Encoding = [System.Text.Encoding]::UTF8` explícito corrompe acentos de texto
  vindo de fontes externas em UTF-8. **Sempre setar essa linha em qualquer novo `WebClient`**
  que busque texto com acentuação. A função do Vercel (Node/`fetch`) nunca teve esse problema.
- **Bug real descoberto nessa sessão — `[Math]::Min()`/`[Math]::Max()` com literal inteiro**:
  `[Math]::Min(5, $x)` onde `5` é escrito sem ponto decimal faz o .NET escolher a sobrecarga
  `Math.Min(Int32, Int32)` e **arredonda `$x` pra inteiro antes de comparar** — um valor como
  `1.5` virava `2` silenciosamente, sem erro nenhum. Descoberto ao implementar pesos fracionários
  na nota de relevância das notícias (seção 15.1.5). **Sempre escrever o literal com ponto
  decimal** (`5.0`) em qualquer `[Math]::Min`/`[Math]::Max` que possa comparar com um `double`.
- **Bug real descoberto nessa sessão — pipeline do PowerShell "desenrola" coleções retornadas**:
  `@($Items | ForEach-Object { Get-AiTitleWordSet $_.title })` onde `Get-AiTitleWordSet` retorna
  um `HashSet[string]` **não produz um array de HashSets** — o pipeline enumera automaticamente
  cada HashSet e devolve todas as palavras de todos os itens misturadas numa lista só. Quebrou
  silenciosamente o clustering de notícias (seção 15.1.4) até ser encontrado via depuração
  isolada. **Correção**: construir a lista com um loop explícito e `.Add()`
  (`[System.Collections.Generic.List[object]]::new()` + `foreach { $list.Add(...) }`) em vez de
  `@($x | ForEach-Object {...})` sempre que o retorno de cada iteração for, ele mesmo, uma
  coleção/array/HashSet.

---

## 4. Design System (CSS)

**Repaginado por completo nessa sessão** — trocou de "terminal escuro estilo Bloomberg" pra um
visual claro, tipo fintech moderna. O usuário forneceu um HTML de referência com o design pronto;
a migração preservou 100% da lógica JS (confirmado por diff).

### Variáveis de cor (`:root`)
```css
--ink: #0f172a;            /* header, rodapé, abas/pills ativas */
--ink-soft: #1e293b;
--page: #eeece7;           /* fundo da página — off-white, ajustado a pedido do usuário */
--card: #faf9f5;           /* fundo dos cards — off-white, mais claro que --page */
--border: #e2dfd7;
--border-strong: #c9c5b9;
--accent: #1d4ed8;         /* azul forte — links, foco, logo, destaques */
--accent-soft: rgba(29,78,216,.07);
--accent-soft-2: rgba(29,78,216,.14);
--green: #16a34a;
--red: #dc2626;
--text: #1f2430;
--dim: #6b7280;
--bright: #0b0e14;
```

**Histórico da cor off-white**: a primeira versão migrada usava `--page: #f1f2f5` (cinza frio) e
`--card: #ffffff` (branco puro). O usuário pediu explicitamente "um off white bem claro ao invés
do branco" — ajustado pra `--page: #eeece7` / `--card: #faf9f5` (tons mais quentes, ligeiramente
amarelados) e as bordas (`--border`, `--border-strong`) recalibradas pra combinar com a
temperatura de cor nova. Se pedirem pra ajustar de novo, mexer nessas 4 variáveis já cobre a
paleta inteira (cards, fundo, bordas).

### Tipografia
```css
--sans: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;   /* textos, labels */
--mono: 'IBM Plex Mono', Consolas, Monaco, monospace;                     /* números */
```
Carregadas via Google Fonts (`<link>` no `<head>`, com `preconnect`) — **dependência de rede
externa nova**; sem internet, cai pro fallback do sistema (ainda funciona, só não fica idêntico).
`html { font-variant-numeric: tabular-nums; }` garante que números fiquem alinhados em coluna
(dígitos de largura fixa) mesmo em fontes proporcionais.

### Logo e favicon
Logo nova em `assets/icon.svg` (quadrado azul `--accent` com cantos arredondados + check branco)
usada no header e no popup da extensão. **Os favicons PNG (raiz e `assets/`) e os ícones da
extensão de Chrome (`chrome-extension/icons/`) continuam com a logo ANTIGA (laranja)** — são
arquivos raster, não dá pra editar via texto; ficou pendente gerar novos PNGs se quiserem
consistência visual total (ver seção 0, pendência 6).

### Estrutura visual
- **Header/rodapé**: navy sólido (`--ink`), texto branco/cinza-claro.
- **Corpo**: fundo off-white (`--page`), cards off-white mais claro (`--card`) com borda sutil e
  sombra leve (`box-shadow: 0 1px 2px rgba(15,23,42,.04)`), cantos arredondados (`border-radius`
  na maioria dos elementos — cards, botões, pills, inputs).
- **Abas e filtros de range** (`.tab-btn`, `.range-btn`, `.subtab-btn`): pílulas — fundo
  transparente/cinza claro quando inativo, `background: var(--ink)` + texto branco quando ativo.
  Substituíram o padrão antigo de texto sublinhado em laranja.
- **Negrito** aplicado em nomes de ativos e valores mais relevantes (`.rname`, `.rval` usam
  `font-weight: 700`), reforçando hierarquia visual sem depender só de cor.

### Responsividade mobile
Bloco `@media (max-width: 640px)` no final do CSS, aditivo — grid principal → 1 coluna, header
empilha, gráficos reduzem altura, modal ocupa 95vw.

### Classes utilitárias principais
| Classe | Uso |
|---|---|
| `.pos` / `.neg` / `.hl` / `.dim2` / `.err` | cores semânticas |
| `.row` | linha de métrica genérica (Índices, Single Names, ETFs) |
| `.row-click` | linha/elemento clicável — abre modal de gráfico ou popup |
| `.lock` | indicador de mercado fechado (texto, sem emoji de cadeado desde a repaginação) |
| `.sn-search-btn` | botão de busca de notícias nas células de Single Names (sem ícone de lupa desde a repaginação — só o botão estilizado) |
| `.sources-link` | texto clicável tipo "fontes"/"consolidado"/"metodologia"/"atualizar" (abre modal ou recarrega) |
| `.etf-disclaimer` | banner de aviso permanente (ETFs Internos) |
| `.heatmap-*` | classes do Heatmap (seção 10) |
| `.ainews-*` | layout tipo "capa de jornal" da aba NOTÍCIAS (seção 15.1.8) |
| `.news-toast*` | pop-up de notificação de notícia (seção 15.1.7) |
| `.modal-overlay` / `.modal-box` | modais genéricos — cada feature tem seu próprio `#id-overlay` |

---

## 5. Sistema de Cache

```javascript
function cacheGet(k) { return JSON.parse(localStorage.getItem('tf_' + k)) }
function cachePut(k, v) { localStorage.setItem('tf_' + k, JSON.stringify(v)) }
```

Cada valor cacheado via `yahoo(ticker)` inclui `fetchedAt: Date.now()`. Usado pelo Heatmap pra
saber se um valor em cache ainda é "fresco" (< 90s).

**Busca de ativos/notícias não usa esse cache** — são ações on-demand (clique pra rodar/atualizar),
fora do ciclo de 60s do `loadAll()`. **NOTÍCIAS também não entra no ciclo de 60s** — roda por
conta própria quando a aba é aberta, mais um ciclo de notificação separado de 120s (seção 15.1.7).

---

## 6. Fontes de Dados por Card (aba ÍNDICES)

### 6.1 Card Brasil
CDI 12M e Selic via BCB (chamada direta do browser); Ibovespa via Yahoo (`^BVSP`); DI Futuro
JAN/30 e JAN/35 via B3 **com fallback pro TradingView** (ver 6.1.1); ETTJ Pré/IPCA/Inflação
Implícita 252du via ANBIMA (`/api/anbima`).

**Bug corrigido (Selic)**: a API do BCB retorna `{"erro":{}}` pra série 432 quando usado
`?formato=json`. Sem esse parâmetro funciona.

#### 6.1.1 DI Futuro — fallback quando a B3 cai
A B3 (`cotacao.b3.com.br`) já ficou fora do ar por completo (HTTP 520, erro de origem do
Cloudflare). `api/b3.js` tenta a B3 primeiro e, se falhar, cai pro **scanner do TradingView**
(`POST scanner.tradingview.com/global/scan`, endpoint interno não documentado, mas estável).
Resposta inclui `source: 'b3'|'tradingview'`; o front-end mostra "via TradingView (B3 fora do
ar)" no sub quando usa o fallback.

**Duas pegadinhas reais desse endpoint**:
1. `/brazil/scan` devolve sempre `{"totalCount":0,"data":[]}` pra contratos futuros — só cobre
   ações. **O endpoint certo é `/global/scan`.**
2. Símbolo do TradingView usa **ano com 4 dígitos** (`DI1F2030`), diferente do formato da B3
   (`DI1F30`, 2 dígitos) — conversão: `symbol.replace(/(\d{2})$/, '20$1')`.

Dado atualizado tem ~15min de delay. Funciona tanto via `curl` quanto via PowerShell — não tem
bloqueio de fingerprint de TLS como uma tentativa anterior via ADVFN (descartada, ver histórico
em versões anteriores deste documento se precisar).

**Histórico de gráfico**: implementado via protocolo WebSocket do TradingView
(`wss://data.tradingview.com/socket.io/websocket`, não documentado publicamente, validado
manualmente). Sequência: `set_auth_token` → `chart_create_session` → `resolve_symbol` →
`create_series` (500 barras diárias, ~2 anos de histórico). Implementação usa o pacote npm `ws`
em `api/b3.js` (rota `?s=X&history=1`) e `System.Net.WebSockets.ClientWebSocket` em `server.ps1`.

**Duas pegadinhas do protocolo**: mensagens envelopadas em `~m~<tamanho>~m~<conteúdo>` com
heartbeats `~h~<n>` que precisam ser ecoados; mensagens grandes chegam fragmentadas e só devem
ser tratadas como completas no frame de fechamento (`EndOfMessage` no .NET) — sem acumular num
buffer até isso, o `timescale_update` chegava cortado e era descartado silenciosamente.

### 6.2 Card Bolsa US
`^GSPC`, `^SPXEW`, `^DJI`, `^IXIC` + pré-mercado `YM=F`, `ES=F`, `NQ=F`.

`/api/yahoo` aceita `&interval=` (usado pelos candles intraday de 5min da aba ETFs Internos —
seção 13.4). Default `1d` se omitido.

### 6.3 Card Europa + Emerging Markets + Câmbio
`^STOXX50E`, `^GDAXI` + `EEM` (ETF, não o índice bruto) na seção Emerging Markets, e uma seção
**Câmbio** com **USD/BRL** (`BRL=X`) e **EUR/USD** (`EURUSD=X`) — adicionados nessa sessão. O
card foi renomeado de "Europa + Emerging Markets" pra "Europa + Emerging Markets + Câmbio" pra
refletir a nova seção.

### 6.4 Card Ásia & Pacífico
`^N225` (Nikkei), `^HSI` (Hang Seng), `^KS11` (KOSPI), `^NSEI` (Nifty 50), `^AXJO` (ASX 200).

### 6.5 Card Juros Globais
Fed Funds Rate (`^IRX`), Taxa BCE (`/api/ecb`), T-Note 10 Anos (`^TNX`).

### 6.6 Card Commodities & Cripto
`BZ=F` (Brent), `CL=F` (WTI), `GC=F` (Ouro), `BTC-USD` (Bitcoin).

#### 6.6.1 Bug real corrigido — variação % errada em commodities/futuros
O Yahoo Finance **não retorna `regularMarketPreviousClose`/`previousClose`** na API de gráfico
(`v8/finance/chart`) pra contratos futuros de commodities (confirmado em `GC=F`, `CL=F`, `BZ=F`)
— esses ativos operam quase 24h, e o corte diário do gráfico não bate com o fechamento oficial da
bolsa. Sem esse dado, `yahooFetch()` caía num heurístico (pegar o 2º valor não-nulo do histórico
diário do próprio gráfico), que **comparava com o fechamento de 2 dias atrás em vez de ontem** —
gerava variações completamente erradas (ex: ouro mostrando +1,34% quando a variação real era
-0,06%).

**Corrigido** buscando o valor oficial via `quoteSummary` autenticado (crumb — mesma técnica de
`api/target.js`), módulo `price`, campo `regularMarketPreviousClose` — **confirmado bater com a
fonte de referência real** num teste direto. Implementado em `api/yahoo.js`
(`fetchOfficialPreviousClose`) e `server.ps1` (`Get-YahooOfficialPreviousClose`): só ativa quando
o chart endpoint não trouxer o valor no `meta` (fallback condicional, não muda nada pros tickers
que já funcionavam — ações, índices). Sem impacto de performance perceptível pros ativos normais.

### 6.7 Card NTN-B (full-width) — com histórico
Snapshot do dia via arquivo texto diário da ANBIMA (`/api/ntnb`), vencimentos 2028-2045. Cada
célula é clicável e o cabeçalho tem um link "consolidado" — seção 8.2.

**Não é intraday** — a ANBIMA publica **um arquivo por dia** (mercado secundário), não uma API
de cotação ao vivo. O terminal mostra a taxa do **último arquivo publicado**, que fica parada
durante o dia até a ANBIMA soltar o arquivo novo. Prazo de coleta das instituições: **12h**; a
publicação em si acontece depois disso, sem horário exato documentado publicamente pela ANBIMA
(confirmado via busca: não achamos um SLA oficial de horário de divulgação, só o prazo de
coleta). Se precisar do horário exato, o jeito é monitorar o endpoint num dia e anotar quando o
arquivo do dia aparece pela primeira vez.

### 6.8 Sub-aba FECHAMENTO — relatório de fechamento de mercado
A aba ÍNDICES ganhou duas sub-abas em pílula logo abaixo do seletor de abas: **HOJE** (o conteúdo
descrito acima, inalterado) e **FECHAMENTO** (`switchIndicesSub()`, lazy-load via flag
`closeReportLoaded`, igual ao padrão de `switchTab()`). Relatório único no estilo "fechamento de
mercado" de banco (Fechamento · Δ dia · Δ mês · Δ ano), agrupado em Renda Fixa / Bolsa /
Commodities e Cripto / Câmbio, com subcategoria de região dentro de Bolsa (Brasil, Estados
Unidos, Europa, Ásia e Pacífico, Emergentes). Config declarativa em `CLOSE_REPORT_CONFIG`.

**Cálculo on-demand, sem cron nem storage.** Cada clique em FECHAMENTO recalcula na hora (com
cache em `localStorage` chaveado pela própria data de referência — reabrir no mesmo "dia de
mercado" não refaz as ~16 chamadas). Fica fora do ciclo de 60s do `loadAll()`, de propósito.

**Data de referência (`computeRefKey()`)**: string `'YYYY-MM-DD'` calculada a partir da hora de
São Paulo via `Intl.DateTimeFormat` (nunca o fuso do navegador — tem colega acessando de fora do
Brasil). Antes das 19h em SP (ou fim de semana) recua pro último dia útil. **Isso não assume que
todo instrumento já fechou às 19h** — Brent/Ouro/Bitcoin/câmbio negociam depois disso — quem
resolve isso é o filtro de barra parcial abaixo, não a hora de corte em si.

**Dois filtros por série, nessa ordem** (`closingSeriesFromChart()`):
1. **Chave de data no fuso da PRÓPRIA bolsa** (`dateKeyTZ(ts, meta.exchangeTimezoneName)`), não
   comparação de epoch bruto contra um corte único em horário de Brasília. Necessário porque a
   barra "de hoje" de um índice asiático nasce à noite anterior em horário de SP, e a barra de
   câmbio publica perto da meia-noite UTC, do lado errado da data conforme o horário de verão
   europeu — testado ao vivo, os dois casos davam data errada com um corte só de epoch.
2. **`dropPartialTail()`**: descarta a última barra enquanto `Date.now()` ainda está dentro de
   `meta.currentTradingPeriod.regular` E essa barra pertence à sessão em curso — evita mostrar um
   preço intraday parcial como "fechamento" quando o relatório é aberto durante o pregão, ou
   entre 19h e a virada do dia pra ativos que negociam até mais tarde que bolsas de ação.

Como cada série usa **"último ponto ≤ refKey"**, feriado por bolsa não precisa de calendário
nenhum: um feriado nos EUA simplesmente mantém os índices americanos no valor de sexta,
automaticamente. Quando o fechamento efetivo de um instrumento cai num dia diferente do refKey do
relatório, a linha mostra a data entre parênteses ao lado do nome.

**Δ dia** compara com o ponto imediatamente anterior da própria série (não um "ontem" fixo) — por
isso também não precisa de lista de feriados. **Δ mês/Δ ano são MTD/YTD**: contra o último ponto
disponível no/antes do último dia do mês/ano anterior (`lastDayOfPrevMonthKey`/
`lastDayOfPrevYearKey` + `lastOnOrBefore`).

**Fontes por instrumento**:
- **13 tickers via Yahoo** (`fetchYahooChartRaw(ticker, '2y')`) — usa **`close`**, não `adjclose`
  (o relatório mostra nível de fechamento; misturar nível de `close` com delta de `adjclose`
  seria inconsistente). Único caso onde isso importa de fato: MSCI EM é o ETF `EEM`, então o Δ
  ano ali é retorno de preço, não retorno total do índice — não usar esse número pra comparar com
  o índice MSCI EM oficial.
- **2 DI Futuro** via `/api/b3?s=..&history=1` (mesmo endpoint da seção 6.1.1, ~2 anos de
  histórico), chave de data em `America/Sao_Paulo` (não tem `currentTradingPeriod`, então só o
  filtro 1 se aplica — funciona porque o filtro de refKey já exclui a barra de hoje enquanto ela
  ainda está em formação).
- **ETTJ Pré**: `api/anbima.js` ganhou um modo `?dates=DD/MM/YYYY,DD/MM/YYYY,...` (não gasta slot
  do teto de 12 — ver seção 19.1.1) que devolve `{results: [...]}`, um item por data pedida,
  `null` quando não encontra. Cada data pedida anda pra trás em dias úteis (`maxTries = 3`, com
  timeout de 3s por tentativa — reduzido de um valor maior por risco real de estourar o limite de
  ~10s de função do Vercel Hobby) até achar um arquivo publicado ou desistir. Front-end faz **duas
  idas** (`closingEttjDeltas()`): primeiro resolve a data efetiva de "hoje" (pode recuar por
  feriado), depois pede ontem/MTD/YTD a partir dessa data já confirmada — evita a base de "ontem"
  colidir com a de "hoje" quando as duas caem no mesmo feriado. Espelho completo em `server.ps1`
  (`Get-EttjOneDay`/`Get-EttjNear`/`Get-BusinessDaysBack`).

**Limitação real e permanente**: a ANBIMA só retém ~5-6 meses de arquivo diário nesse endpoint —
testado ao vivo (11/08/2026): `27/02/2026` responde, `20/02/2026` e `30/12/2025` voltam vazio.
**Δ ano da ETTJ Pré aparece como "n/d"** sempre que a base (31/dez do ano anterior) já saiu dessa
janela — na prática, de meados do ano até a virada. Δ dia e Δ mês não são afetados. Isso é
esperado, não é bug; o código degrada sozinho sem hardcode de data.

**Divergências conhecidas vs. um relatório de fechamento de banco de verdade**: futuros de
commodities (`BZ=F`/`GC=F`) usam o bucket diário do Yahoo, não o preço de ajuste/settlement
oficial da bolsa (mesma ressalva já documentada na seção 6.6.1 pro card ao vivo); "fechamento" de
Bitcoin é convenção do Yahoo (23:59 UTC), não um conceito real de fechamento de cripto; ETTJ Pré
não existe em relatórios desse tipo, incluído aqui a pedido do usuário.

---

## 7. Indicador de Mercado Fechado

Usa `meta.currentTradingPeriod.regular` do Yahoo (`{start, end}` em epoch seconds):
```javascript
const ctp = m.currentTradingPeriod?.regular;
const marketOpen = ctp ? (Date.now()/1000 >= ctp.start && Date.now()/1000 <= ctp.end) : null;
```
`renderMkt()` popula `<span class="lock" id="{prefix}-lock">` (convenção: `{prefix}-val` →
`{prefix}-lock`; desde a repaginação, o indicador é só texto, sem emoji de cadeado). Bitcoin
nunca mostra indicador de fechado. `/api/yahoo` usa `includePrePost=false`.

---

## 8. Modal de Gráfico Individual + Seleção Manual de Intervalo

### 8.1 Modal básico (clique em qualquer ativo)
`openChart(ticker, name)` abre modal com Chart.js, janelas **1M/3M/YTD/1A/5A** + **"DESDE O
INÍCIO"** pra Single Names (ver `SINGLES_ENTRY_DATES`). Guarda contra race condition ao trocar
de ativo/janela rápido. `fmtEntryDate(dateStr)` evita bug de fuso horário (nunca usar
`new Date(dateStr).getDate()` pra formatar uma data ISO como rótulo — volta um dia).

**Preço de entrada manual**: `SINGLES_ENTRY_PRICE_OVERRIDES` permite forçar um preço de entrada
específico em vez de depender do fechamento oficial da série.

### 8.2 NTN-B · Histórico/Consolidado
Cada célula NTN-B é clicável (`openNtnbHistory(year)`) e mostra o histórico daquele vencimento
específico. O link "consolidado" no cabeçalho do card (`openNtnbHistory()` sem argumento) mostra
as 6 curvas juntas. Janelas: **5D / 1M / 3M / 6M / 1A**. Backend: `/api/ntnb?days=N` busca o
arquivo diário da ANBIMA pra cada pregão do período, em paralelo.

**Limitação real**: a ANBIMA só retém ~5-6 meses de arquivo diário nesse endpoint público. Pedir
"1A" não quebra, mas devolve só o que existe. Pra janelas grandes, o backend faz **amostragem**
(1 em cada N dias, ≤90 requisições no pior caso) — `MAX_SAMPLES = 90` em `api/ntnb.js`.

### 8.3 Seleção manual de intervalo (clicar e arrastar, estilo Google Finance)
Plugin genérico do Chart.js (`dragRangePlugin`). Clicar e arrastar sobre qualquer gráfico
habilitado desenha uma área sombreada + linhas verticais tracejadas + uma caixa flutuante com a
variação absoluta e percentual entre os dois pontos — pra cada dataset visível.

**Gráficos com o plugin ativado**: modal individual, Portfólio, ETFs Internos, NTN-B histórico,
DI Futuro histórico. **Não ativado** no scatter de Risco×Retorno do Portfólio (eixo X é risco,
não tempo).

**Bug real corrigido**: por padrão o Chart.js só escuta `mousemove, mouseout, click, touchstart,
touchmove` — `mousedown`/`mouseup` **não estão na lista padrão**. Precisa declarar
explicitamente em cada gráfico:
```javascript
events: ['mousedown', 'mousemove', 'mouseup', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'],
```
Sem isso o plugin nunca recebe o `mousedown` inicial e a seleção simplesmente não funciona (sem
erro nenhum). Se adicionar o plugin a um gráfico novo e a seleção não funcionar, checar isso
primeiro.

---

## 9. Aba SINGLE NAMES

Grid de equities (composição evolui — ver `SINGLES` no código pra lista atual). Cada célula
mostra preço, variação, price target de analistas (via `/api/target.js`) quando disponível.

### 9.1 Busca de ativos (herdada da extinta aba BUSCAR)
Card no topo da aba, acima da grade de equities: campo de texto livre (`asset-search-input`) que
resolve pra ticker via `/api/quote-search` e mostra cotação com gráfico clicável
(`runAssetSearch()`). Resultado aparece num card próprio (`asset-search-results-card`) que fica
oculto até a primeira busca. Mesma função que existia na sub-aba ATIVOS de BUSCAR, só realocada.

### 9.2 Gráfico e busca de notícias por ativo
Mesmo modal da seção 8. Botão (`.sn-search-btn`) abre notícias específicas daquele ativo via
`openTickerNews()` (modal dedicado, usa `/api/news?t=TICKER`).

---

## 10. Aba HEATMAP

Treemap visual, 5 grupos: Single Names Portfolio, Bolsa US, Índices Futuros, Europa + Ásia +
Emerging Markets (com KOSPI), Commodities e Cripto.

### 10.1 Algoritmo
Squarified treemap próprio (`computeTreemap`). **Não voltar pra divisão binária simples**
(slice-and-dice) — produzia tiras finas e feias.

### 10.2 Correção de tamanho (bug real corrigido)
Tamanho do bloco era proporcional direto a `|chg|` — variações muito desiguais na mesma "linha"
squarified geravam células degeneradas (texto ilegível). **Corrigido aplicando raiz quadrada**:
```javascript
const items = group.data.map(d => ({ ...d, value: Math.sqrt(Math.max(Math.abs(d.chg) || 0, 0.15)) }));
```
Se um heatmap novo tiver células ilegíveis, aplicar a mesma raiz quadrada.

### 10.3 Cor e cache
Cor por `heatColor(chg)` (verde/vermelho por intensidade, paleta ajustada pro tema claro).
Cabeçalho de grupo = média aritmética simples. Reaproveita cache do ciclo de 60s (`fetchedAt` <
90s).

---

## 11. Aba PORTFÓLIO

Simulador equal-weight dos Single Names. Janelas 3M/6M/YTD/1A/2A. Preço histórico via **Yahoo
Finance, `adjclose`** (ajustado por dividendos/desdobramentos, não o preço bruto).

### 11.1 Metodologia de cálculo (`calcStats(prices)`)
Sem taxa livre de risco (Rf = 0) — documentado assim no modal de Fontes.

1. **Retornos diários**: `(preço_hoje − preço_ontem) / preço_ontem` pra cada dia da série.
2. **Volatilidade**: desvio-padrão dos retornos diários, **anualizado multiplicando por
   `√(dias_por_ano)`** — `252` se a janela tem mais de 150 pontos de dados (6M pra cima), ou `52`
   (tratando os pontos como semanais) se a janela for mais curta (3M):
   ```javascript
   const dpy = dailyRets.length > 150 ? 252 : 52;
   const vol = Math.sqrt(variance) * Math.sqrt(dpy);
   ```
3. **Retorno anualizado**: composto, não é média simples —
   `(1 + retorno_total)^(dias_por_ano / nº_retornos) − 1`.
4. **Sharpe**: `retorno_anualizado / volatilidade`, **sem desconto de taxa livre de risco**
   (aproximação simplificada, não o Sharpe "oficial" que desconta Selic/T-Bill).

- **Desempenho Relativo · base 100**: linha do portfólio + linha pontilhada do S&P 500
  (benchmark). Seleção manual de intervalo habilitada (seção 8.3).
- **Risco × Retorno · Sharpe**: scatter, sem seleção manual (eixo X é risco).
- Retorno via `calcStats` é **CAGR/composto**, diferente do que os ETFs Internos usam (retorno %
  simples acumulado) — não comparar os números diretamente entre abas diferentes.

---

## 12. [REMOVIDO] Aba SIMULADOR — Fronteira Eficiente de Markowitz

**Completamente removida** a pedido explícito do usuário. Foram apagados: botão de navegação,
painel HTML inteiro, ~30 funções JS com prefixo `mk`, CSS `.mk-*`, e a seção correspondente no
modal de Fontes. `SIMULADOR_METODOLOGIA.md` continua no repo documentando a matemática exata, só
como histórico. **Não recriar sem pedido explícito.**

---

## 13. Aba ETFS INTERNOS

Dois ETFs sintéticos ("montados por nós", não produtos negociáveis reais): Equipamento IA ETF
(fabricantes de equipamento de litografia/produção de chips) e Memória IA ETF (fabricantes de
chips de memória).

Cada holding tem um peso fixo (`ETFS` constant no JS). O índice ponderado (base 100) é calculado
a partir do retorno % de cada ativo — a moeda de cotação não afeta o cálculo, só o retorno
percentual entra.

### 13.1 Papéis originais, não ADRs
Vários holdings usam o ticker da bolsa de origem em vez do ADR americano (mais liquidez e track
record): Tokyo Electron (`8035.T`, JPY), SK Hynix (`000660.KS`, KRW), Kioxia (`285A.T`, JPY),
Samsung Electronics (`005930.KS`, KRW — nunca teve ADR líquido). ASML usa o ADR da Nasdaq (USD),
os demais (Applied Materials, Lam Research, KLA, Micron, SanDisk) já eram ações americanas
nativas.

**Notas explicativas removidas da interface** (mudança dessa sessão, a pedido do usuário): antes,
cada holding não-USD tinha um texto tipo "cotada em JPY (Tokyo Stock Exchange) · só o retorno %
entra no índice" na linha — foi removido pra deixar o formato **igual ao dos holdings em USD**
(só `TICKER · MOEDA`). O campo `note` foi removido dos objetos de holding no JS (não é mais
usado, e não precisa ser reintroduzido).

### 13.2 Alinhamento por dia calendário (bug real corrigido)
Misturar ativos de bolsas em fusos horários diferentes usando **timestamp exato** faz um ativo
"entrar e sair" do índice a cada dia, criando serrilhado artificial. **Corrigido alinhando por
dia calendário** (`YYYY-MM-DD`, UTC), não por timestamp bruto.

### 13.3 Peso redistribuído pra ativos recém-listados
Cada ativo entra a partir da sua própria primeira data disponível, redistribuindo o peso dos
ausentes entre os presentes naquele dia (igual um índice real trata a entrada de um novo
constituinte).

### 13.4 Modo INTRADIA
Botão "INTRADIA" busca candles de 5 minutos (`&interval=5m`) pro pregão mais recente de cada
ativo. O índice combinado usa uma linha do tempo absoluta: ativos de bolsas já fechadas ficam
"congelados" no último preço conhecido, bolsas ainda abertas continuam atualizando.

### 13.5 Coluna de peso — bug de alinhamento corrigido nessa sessão
A linha de cada holding usa `display: flex; justify-content: space-between` com **3 elementos**
(nome, peso, preço), mas o **cabeçalho** (`.etf-holdings-head`, "ATIVO" / "PESO") só tinha **2**
elementos — isso fazia o rótulo "PESO" alinhar no canto direito (onde fica o preço), enquanto os
percentuais de peso reais ficavam mais à esquerda, visualmente desalinhados da própria coluna que
anunciam. **Corrigido trocando pra CSS Grid** com o mesmo `grid-template-columns: 1fr 56px
minmax(90px, max-content)` tanto no cabeçalho quanto nas linhas (classe `.etf-holding-row`
adicionada às linhas) — garante que as 3 colunas (nome / peso / preço) alinhem exatamente na
mesma posição em todo lugar, cabeçalho incluso, independente da largura variável do nome de cada
ativo.

### 13.6 Retorno da janela por holding + seleção manual
Cada holding mostra sua própria variação % na janela selecionada. Seleção manual de intervalo
habilitada nos gráficos de índice (seção 8.3).

---

## 14. [REMOVIDO] Aba BUSCAR

**Removida** junto com a aba CNBC, a pedido do usuário. Tinha sub-abas NOTÍCIAS (busca livre +
feed do mercado americano via `/api/news`, apagada de vez — `loadFeed`/`fetchMarketNews`/
`runFeedSearch` não existem mais) e ATIVOS (resolve texto em ticker via `/api/quote-search`) — a
sub-aba ATIVOS foi **preservada e movida pra dentro da aba SINGLE NAMES** (seção 9.1, mesmo
`runAssetSearch()`, só trocou de card). O endpoint `/api/news` continua existindo — usado pelo
botão de busca de notícias dos Single Names (`openTickerNews`, sempre passa um ticker) e pelo
"resumir com IA" (`action=summarize`).

**Resumo por IA sob demanda** (`/api/news?action=summarize&url=...&title=...`): busca o HTML do
artigo, extrai texto via regex, manda pro Gemini (`gemini-2.5-flash`, free tier, 5 req/min).
Reaproveitado pela aba NOTÍCIAS (seção 15.1) — mesmo endpoint, mesmo botão "resumir com IA".

---

## 15. [REMOVIDO] Aba CNBC (BETA)

**Removida** a pedido do usuário — "CNBC não faz sentido, já temos o portal na parte de
notícias" (a fonte CNBC já está coberta dentro do recorte por palavra-chave da aba NOTÍCIAS,
seção 15.1, então a aba dedicada ficou redundante). Agregava manchetes via RSS oficial da CNBC (7
feeds), com um pacote de destaque (hero + 2 secundários, raspando a home `cnbc.com/world`).
Apagados: botão de navegação, painel HTML, JS (`loadCnbc`, `filterCnbc`, `renderCnbcList`,
`renderCnbcTopStory`), CSS `.cnbc-*`, o arquivo `api/cnbc-news.js` e a função `Get-CnbcTopStory` +
rota espelhada em `server.ps1`. **Não recriar sem pedido explícito.**

---

## 15.1 Aba NOTÍCIAS

Nome final é "NOTÍCIAS" (começou como "IA & CHIPS (BETA)", ampliado depois pra cobrir mercado
financeiro/política/geopolítica/economia em geral). Internamente os IDs/nomes de função ainda
usam `ainews`/`aiNews*`. Três sub-abas: **TOP PICKS**, **NACIONAL**, **INTERNACIONAL**.

### 15.1.1 Origem
Reciclado de um agregador de notícias em Python que o usuário já tinha rodando fora do terminal.
`api/ai-news.js` reimplementa a mesma lógica em JS: paginação WordPress (`?paged=N`), Reuters via
Google News (bloqueia scraping direto, sem RSS público próprio), limpeza de título (sufixos
"- Fonte"/"by Fonte", rodapé Jetpack), filtro de "lixo" (páginas de cotação automática),
deduplicação por link e título normalizado.

### 15.1.2 Fontes — 12 no total, G1 pausado
Config em `SOURCES` (`api/ai-news.js`) / `Get-AiNewsSourcesConfig` (`server.ps1`):

| Fonte | Região (padrão da fonte) | Observação |
|---|---|---|
| CNBC | internacional | 5 feeds RSS |
| Reuters | internacional | via Google News (`site:reuters.com`) — sem RSS próprio |
| Brazil Journal | nacional | paginação WordPress, 4 páginas |
| InfoMoney | nacional | paginação WordPress, 5 páginas |
| Investing.com | internacional | 6 feeds RSS |
| NeoFeed | nacional | |
| Poder360 | nacional | |
| BBC | internacional | 2 feeds RSS (World, Business) |
| Valor Econômico | nacional | pago, mas RSS público expõe manchete/resumo livre |
| WSJ | internacional | feeds RSS oficiais (`feeds.a.dj.com`) estão **mortos** (confirmado: pubDate parado desde jan/2025 ou antes) — usa Google News como proxy (`site:wsj.com`) |
| Bloomberg | internacional | sem RSS oficial (descontinuado); homepage bloqueia scraping (403, bloqueio de bot, não paywall) — usa Google News como proxy (`site:bloomberg.com`) |
| Yahoo Finance | internacional | RSS público oficial (`finance.yahoo.com/news/rssindex`), confirmado ativo |

**G1 (pausado, não removido)** — a pedido do usuário: "retire o G1 como fonte, deixe a fonte
salva, mas por enquanto a remova do nosso terminal". Config **comentada** em `SOURCES` e
`SOURCE_HOMEPAGES` (JS) / `Get-AiNewsSourcesConfig` e `Get-AiSourceHomepages` (PowerShell) —
descomentar pra reativar. Usava as editorias Economia e Política (`/rss/g1/{editoria}/`), não o
feed geral.

**Login/paywall não é necessário pra nenhuma fonte paga** (Valor, WSJ, Bloomberg) — todas expõem
RSS público de headline/resumo mesmo com o artigo completo pago. Testado e descartado: mesmo se
quisesse, login programático não resolveria o bloqueio do Bloomberg (403 é bloqueio de bot na
borda tipo Cloudflare/Akamai, não parede de paywall).

### 15.1.3 Filtro de palavras-chave — duas listas + exigência de 3+ termos
Duas listas fixas em `api/ai-news.js` (espelhadas em `server.ps1` como `$AI_KEYWORDS`/
`$AI_EXCLUDE_KEYWORDS`) — lista completa exportada em `PALAVRAS_CHAVE_NOTICIAS.md`:
- **`KEYWORDS`** (inclusão, ~370 termos): IA/chips, empresas do setor, mercado financeiro,
  política, geopolítica, economia. Fornecida pelo usuário, não editar sem pedido explícito.
- **`EXCLUDE_KEYWORDS`** (exclusão, ~30 termos): curso, horóscopo, esporte, entretenimento,
  promoção, publicidade etc.

Mecânica: normaliza o texto (remove acento, minúsculas), cada palavra-chave vira um padrão
`\bpalavra\b` (fronteira de palavra), conta quantas DISTINTAS batem. Se **qualquer** termo de
`EXCLUDE_KEYWORDS` bate, descarta na hora.

**Exigência subiu de 1 → 2 → 3 termos distintos batendo** (`MIN_KEYWORD_MATCHES = 3`), em duas
rodadas de ajuste depois de investigar falsos positivos concretos (termos genéricos com sentido
duplo em português — "ações", "consumo", "retorno", "taxa", "intervenção", "invasão",
"investigação" — já **removidos da lista de inclusão**, não só compensados pelo threshold).

**Bug real de cobertura incompleta corrigido nessa sessão — formas plurais faltando**: a lista
tinha `Payroll` mas não `Payrolls`, `rate cut`/`rate hike` mas não `rate cuts`/`rate hikes` — uma
manchete como "Daily Spotlight: Payrolls Fall, Hikes Less Likely" batia **zero** palavras-chave
por causa disso (com fronteira de palavra `\b`, o singular não casa dentro do plural). Corrigido
adicionando as formas plurais que faltavam. **Lição pra manutenção futura**: ao adicionar um
termo novo em inglês, considerar se a forma plural comum também precisa entrar — o filtro não faz
nenhum tipo de stemming/lematização, é match literal por fronteira de palavra.

### 15.1.4 Clustering — "mesma notícia, veículos diferentes" (reescrito nessa sessão)
Duas manchetes sobre a mesma notícia raramente têm redação parecida ("BP's $5.7bn profit highest
since 2022..." vs "BP profit more than doubles as Trump blasts Big Oil..."). Um Jaccard simples
de palavras (versão antiga) subestimava isso: as palavras em comum tendem a ser genéricas (que
aparecem em dezenas de matérias do mesmo ciclo, ex: "oil", "war"), e a palavra que de fato
identifica a história ("BP") é curta e ficava fora do corte de tamanho mínimo.

**Corrigido com peso tipo TF-IDF**: cada palavra do título pesa pelo inverso de quantas matérias
do ciclo a contêm — `idf(palavra) = log((N+1)/(df+1)) + 1`, sempre positivo, mais alto pra
palavras raras. Similaridade final é um cosseno ponderado (`weightedSimilarity`) entre os
conjuntos de palavras de dois títulos. Constantes: `MIN_WORD_LEN = 2` (palavras curtas tipo "BP"
agora contam — antes o corte era 4), `CLUSTER_SIMILARITY = 0.22` (limiar calibrado com casos
reais), `CLUSTER_MAX_TIME_GAP = 48h` (fora dessa janela, a mesma palavra rara em comum é
coincidência, não a mesma notícia). Testado e confirmado: BBC e CNBC noticiando o mesmo lucro da
BP com manchetes totalmente diferentes agora **são** reconhecidas como a mesma história.

### 15.1.5 Nota de relevância (1-10)
Três componentes, calculados em `assignRelevance()` (JS) / `Set-AiRelevance` (PowerShell):

**(a) Multi-veículo (até 5 pontos)**: cada veículo distinto que noticia a mesma história (via
clustering, seção 15.1.4) soma pontos — **1,5 por veículo de origem nacional, 2 por veículo de
origem internacional** (pesos a pedido do usuário; note que isso usa a região FIXA do veículo,
`OUTLET_WEIGHT[SOURCE_REGION[outlet]]`, diferente da classificação por assunto da matéria em si —
ver seção 15.1.6). Item sozinho (sem cluster) ainda conta o próprio veículo.

**(b) "Manchete real" (5 ou 1 ponto)**: o link da matéria está de fato na homepage da fonte
**agora**? Implementado com raspagem real (`fetchHomepagePaths`/`Get-AiHomepagePaths`) — baixa a
homepage de cada fonte uma vez por ciclo e extrai todos os `href` linkados; se o link da matéria
aparece lá, nota 5, senão 1. **WSJ e Bloomberg ficam de fora** (homepage devolve 401/403 pra
fetch simples) e caem pro proxy antigo: top 3 posições da página 1 do próprio feed RSS. Reuters
também usa o proxy antigo (usa Google News, que não reflete a home real do site).

**(c) Bônus de temas prioritários (+2, opcional)**: curadoria pessoal do usuário —
`PRIORITY_KEYWORDS`, lista **separada** de `KEYWORDS` (essa não filtra nada, só soma pontos):
- Juros/bancos centrais: Fed, Powell, Copom, Selic, BCE, dot plot, rate cut(s)/hike(s), relatório
  de emprego dos EUA (payroll/nonfarm payrolls/jobs report), etc.
- Mercado de ações US com foco em IA: S&P 500, Nasdaq, Magnificent Seven, Nvidia, Microsoft,
  OpenAI, Anthropic, capex de IA, etc.
- Geopolítica: China, Taiwan, Rússia, Irã, Israel, OPEP, tarifas, etc.
- **Single Names da carteira pessoal**: `AMZN`, `MSFT`, `NVDA`, `ASML`, `SMH`, `Danaher`, `DHR`,
  `Visa`, `Vistra`, `VST`, `GLD`, `GOOGL` (mais os nomes Amazon/Microsoft/Nvidia/Google, já
  cobertos na seção de ações). **O ticker "V" (Visa) foi deixado de fora de propósito** — uma
  letra isolada como palavra-chave gera falso positivo demais (testado: "revisar"/"em V"
  batem numa checagem menos rigorosa); "Visa" (nome) já cobre o essencial.

**Nota final** = soma dos três, com teto em 10 (`Math.min(10, ...)`). **Top Pick** = nota ≥ 6.
Pode dar número fracionário (ex: `4.5`, `8.5`) por causa do peso 1,5 do componente (a).

### 15.1.6 NACIONAL vs INTERNACIONAL — por ASSUNTO, não por veículo (mudança grande dessa sessão)
**Antes**: classificação simples pela fonte que publicou (G1/Brazil Journal/InfoMoney = nacional,
CNBC/Reuters/Investing.com = internacional). **Problema real reportado pelo usuário**: um portal
brasileiro (Valor, InfoMoney) noticiando o mercado americano (ex: "Relatório de emprego dos EUA
concentra as atenções dos investidores") caía em NACIONAL só por ter sido publicado no Brasil —
errado, o assunto é internacional.

**Corrigido** com `classifyRegion(title, summary, sourceRegion)`: duas listas de sinais
(`BR_REGION_KEYWORDS` — Brasil, Selic, Lula, STF, Petrobras, Itaú, etc.; `INTL_REGION_KEYWORDS` —
EUA, Fed, Wall Street, China, Nvidia, Trump, nomes de capitais estrangeiras, etc.). Conta quantos
sinais de cada lado aparecem no título+resumo; quem tiver mais vence. **Empate ou nenhum sinal
claro cai no critério antigo** (a região da fonte) como fallback razoável — por exemplo, uma nota
de mercado genérica sem geografia explícita continua indo pra onde o veículo "pertence".

Testado e confirmado: as 5 matérias sobre o relatório de emprego americano (publicadas por Valor
e InfoMoney) passaram a cair corretamente em INTERNACIONAL.

**Nota**: essa classificação por assunto é usada só pra decidir NACIONAL/INTERNACIONAL (as
sub-abas visíveis). O peso do componente (a) da nota de relevância (seção 15.1.5) continua usando
a região FIXA do veículo (`SOURCE_REGION`), não essa classificação dinâmica — são dois conceitos
diferentes por design (um é "de onde é esse assunto", o outro é "que peso esse veículo tem
quando cobre algo").

### 15.1.7 Sistema de notificação (pop-up) — novo nessa sessão
Funciona em duas situações pedidas pelo usuário:
1. **Com o terminal aberto** (em qualquer aba, não só NOTÍCIAS): uma notícia nova que bata o
   limiar dispara um pop-up, via `checkAiNewsNotifications()` rodando num ciclo próprio.
2. **Ao abrir o terminal**: notícias que já bateram o limiar recentemente (e ainda não foram
   "vistas" nesse navegador) também aparecem — a primeira checagem roda no load da página.

**Limiar: nota = 10** (`NEWS_NOTIFY_THRESHOLD`, reduzido de um teste inicial em 8,5 a pedido do
usuário — "mantenha APENAS para notícias NOTA 10"). Ciclo de checagem: **120s**
(`NEWS_NOTIFY_POLL_SECONDS`, separado do ciclo de 60s do resto do terminal, pausa/retoma junto
com ele via `visibilitychange`). Máximo **5 pop-ups por checagem** (`NEWS_NOTIFY_MAX_PER_CHECK`,
evita avalanche — o resto fica pro próximo ciclo). Deduplicação via `localStorage`
(`tf_notified_news_links`, até 500 links guardados) — nunca repete a mesma notícia.

Visual: toast no canto superior direito (`#news-toast-container`), nota + título + fonte, clique
abre a notícia em nova aba, "✕" fecha na hora (sem emoji desde a repaginação, só o botão
estilizado), desaparece sozinho depois de 12s.

### 15.1.8 Janela de tempo escalonada por nota — Top Picks
**Janela padrão: 2h** (`TOP_PICKS_SCORE_WINDOW_HOURS`) — dentro dela, o hero/destaque da aba TOP
PICKS prioriza a **maior nota**, não a mais recente (objetivo: "o que é mais importante agora",
não um feed cronológico). **Nota ≥ 9 ganha uma janela maior: 6h**
(`TOP_PICKS_HIGH_SCORE_MIN = 9`, `TOP_PICKS_HIGH_SCORE_WINDOW_HOURS = 6`) — a pedido do usuário,
já que notícias tão relevantes são mais raras e vale a pena continuarem em destaque por mais
tempo. Fora da janela aplicável a cada item, cai pro critério antigo (mais recente primeiro), como
fallback pra quando nada bateu na janela.

### 15.1.9 Janela de tempo geral (busca de dados)
**72 horas** (`HOURS_WINDOW`/`$windowCutoff`) — mais larga que as antigas 24h da CNBC (removida)
porque é um recorte por tema sobre fontes que também publicam muita coisa fora do escopo.

### 15.1.10 Interface — layout "capa de jornal"
Reaproveita `summarizeNews()` (mesmo botão "resumir com IA" via `/api/news?action=summarize`).
Layout tipo capa de jornal em `renderAiNewsMagazine()`: a matéria de destaque (hero, `.ainews-hero`)
grande, as próximas 4 (`.ainews-secondary`) em tamanho médio, 2 colunas, o resto
(`.ainews-compact`) em cards compactos, 2 colunas — todos com fundo/borda de card real (grid
consistente), não mais um texto corrido sem separação visual. Rótulos de seção ("Mais recentes"/
"Outras notícias") entre os grupos.

**Metodologia num modal, não mais um banner grande**: o antigo aviso `.etf-disclaimer` (texto
longo sempre visível no topo da aba) virou um botão discreto "metodologia" (`openAiNewsMethodology()`)
que abre um modal dedicado (`#ainews-methodology-overlay`) com a explicação completa — cabeçalho
da aba ficou bem mais limpo.

**Filtros (todos client-side, sem nova chamada de API)**:
- **Veículo**: checkboxes geradas dinamicamente a partir das fontes que realmente vieram na
  resposta da aba atual (`renderAiNewsSourceChecks()`). Multi-seleção (nenhuma marcada = mostra
  todas). Regenerada toda vez que troca de aba.
- **Período**: 1H / 6H / 12H / 24H / 24H+ (sem corte, até o limite de 72h do backend).
- **Busca por palavra-chave**: filtra `title`+`summary` do conjunto já carregado, com opção
  "palavra-chave só no título".

---

## 16. [REMOVIDO] Aba BONDS (BETA)

**Completamente removida**, depois de uma sequência de tentativas de correção que expuseram um
problema estrutural na fonte de dados (bondterminal.com). Causa raiz final: **cota diária de
cálculos esgotada** de forma persistente na conta/plano da API, mesmo depois de corrigido um bug
real de concorrência no código (pool sem limite de requisições simultâneas, estourando o limite
de 4 in-flight da API). Diante da persistência do problema, o usuário optou por remover a aba.
`Bonds Carteira.xlsx` ficou órfã no repo. **Não recriar sem pedido explícito** — e se pedir,
checar primeiro se o problema de cota/plano do bondterminal.com foi resolvido.

---

## 17. Modais de "Fontes & Metodologia"

Dois modais distintos:
- **`#sources-overlay`** — texto "fontes" clicável no cabeçalho geral do terminal. Resumo
  condensado das fontes de cada aba (Brasil, Bolsa US, Europa+EM+Câmbio, Ásia, Juros Globais,
  Commodities, NTN-B, Single Names, Portfólio, Heatmap, Notícias, Atualização). As seções de
  Simulador, Bonds, CNBC e Busca foram removidas junto com as respectivas abas.
- **`#ainews-methodology-overlay`** — específico da aba NOTÍCIAS (seção 15.1.10), aberto pelo
  botão "metodologia" no cabeçalho do painel, não pelo link "fontes" geral.

A sub-aba FECHAMENTO (seção 6.8) **não** usa nenhum desses modais — a explicação de fontes/MTD-
YTD/limitação da ETTJ fica numa nota fixa (`.close-note`) dentro do próprio card, por ser curta o
suficiente pra não precisar de modal dedicado.

---

## 18. Otimização de Custo do Vercel

Plano **Hobby**: limite de 1M invocações/mês. Auto-refresh (60s) só dispara enquanto uma aba está
aberta e em foco (`visibilitychange` pausa o timer em segundo plano). **NOTÍCIAS não entra no
ciclo de 60s** — carrega ao abrir a aba e tem seu próprio ciclo de notificação de 120s (seção
15.1.7), então não pesa no limite de invocação do mesmo jeito que os cards que atualizam
automaticamente. Mesmo assim, o ciclo de notificação roda em background o tempo todo que o
terminal estiver aberto (mesmo fora da aba NOTÍCIAS) — vale ter em mente se o uso de invocações
subir de forma inesperada no futuro.

### 18.1 Incidente real: `FUNCTION_INVOCATION_FAILED`
Todas as funções falharam simultaneamente com `500`. **Não foi limite de invocação**. Causa raiz
real: `EnvFileReadError` no runtime do Vercel (falha de infraestrutura, não de código) —
resolvido com **Redeploy** manual. Lição: se **todas** as funções falharem de forma idêntica,
suspeitar de infraestrutura/config do projeto no Vercel, não do código — confirmar via **Logs**
reais do deployment antes de qualquer suposição.

---

## 19. Deploy

### 19.1 `package.json` é obrigatório
Todo `api/*.js` usa ES Module. `package.json` declara `"type": "module"`. **Nunca** usar
`module.exports` num arquivo novo. Também declara a dependência `ws` (cliente WebSocket, usado
pelo histórico de DI Futuro) — precisa estar de fato no repositório pro build funcionar.

### 19.1.1 Limite de 12 funções serverless no plano Hobby
O Vercel Hobby limita a **12 Serverless Functions por deployment** (1 função = 1 arquivo em
`api/*.js`). Já batemos nesse limite antes — resolvido fundindo pares de endpoints da mesma
fonte de dados numa função só cada (`b3.js`+`di-history.js`, `ntnb.js`+`ntnb-history.js`,
`news.js`+`summarize-news.js`). **Atualmente 10 arquivos em `api/`** (incluindo o órfão
`summary.js`, seção 0 pendência 4) — ainda com 2 de folga.

**Lição real**: apagar um arquivo localmente **não remove ele do repositório remoto** se o
próximo upload não incluir a remoção explicitamente — já virou órfão contando pro limite antes.
Sempre que remover uma aba/feature que tinha arquivo(s) próprio(s) em `api/`, **lembrar de
deletar esses arquivos no GitHub também**. Ao criar uma função nova, considerar primeiro se ela
pode virar uma rota dentro de um arquivo já existente da mesma fonte de dados.

### 19.2 Fluxo do Daniel (não é git CLI)
Sobe arquivos manualmente pela interface web do GitHub ("Add files via upload"), que dispara
redeploy automático no Vercel. **Sempre listar exatamente quais arquivos mudaram** ao final de
cada tarefa, e avisar explicitamente quando um arquivo precisa ser **deletado** no repositório
(não só criado/atualizado). A pasta `chrome-extension/` **nunca** vai pro GitHub/Vercel.

### 19.3 Variáveis de ambiente necessárias no Vercel
| Variável | Usada por | Obrigatória? |
|---|---|---|
| `GEMINI_API_KEY` | `api/news.js` (`?action=summarize`) | Sim, pro botão "resumir com IA" |

`BONDS_API_KEY` não é mais usada — pode ser removida do Vercel (Settings → Environment
Variables).

---

## 20. Cuidado com Credenciais

Daniel já colou credenciais direto no chat por engano **várias vezes** ao longo do projeto —
incluindo uma vez uma chave que pensava ser de um serviço (bondterminal.com) mas era na verdade
uma chave de produção de um serviço completamente diferente (Blueticks, API de WhatsApp, sem
relação com o projeto).

**Lição**: o prefixo de uma chave não é garantia de qual serviço ela pertence — sempre testar
contra o endpoint esperado antes de assumir, e nunca usar uma credencial sem confirmar a origem,
mesmo que o usuário diga que é de um serviço específico.

Sempre que orientar sobre gerar uma credencial: **reforçar que deve colar só no painel do
provedor ou nas Environment Variables do Vercel, nunca no chat**. Se uma credencial real aparecer
na conversa, tratar como potencialmente exposta — orientar revogar/rotacionar, mesmo que depois
se confirme que era a chave "certa" (o hábito de nunca colar chave em chat vale sempre,
independente do resultado).

---

## 21. Extensão de Chrome (`chrome-extension/`)

Popup (Manifest V3) com 3 abas: ÍNDICES (5 principais), SINGLE NAMES, BUSCA (sub-abas
Notícias/Ativos). Reaproveita os mesmos endpoints de `api/*.js` do domínio publicado.

**Redesenhada nessa sessão** pra bater com o visual novo do terminal principal: mesmas variáveis
de cor (`--ink`, `--page`, `--card`, `--accent`, off-white ajustado), mesma tipografia (IBM Plex
Sans/Mono, via Google Fonts), abas e sub-abas em pílula (fundo navy quando ativa) em vez do
padrão antigo escuro com sublinhado laranja. **`popup.js` não mudou** — só o CSS/HTML de
`popup.html`, mesma lógica de sempre.

**Ainda não reflete ETFs Internos nem NOTÍCIAS** — se o usuário quiser essas abas na extensão
também, é trabalho novo a partir do que já existe em `index.html`.

**Ícones da extensão (`chrome-extension/icons/`) continuam com a logo ANTIGA** (laranja) — são
PNGs, mesma limitação dos favicons do site principal (seção 4).

**Não faz parte do deploy do Vercel** — instalada manualmente via `chrome://extensions` →
"Carregar sem compactação", apontando pra essa pasta.

**Detalhes importantes**: `popup.js` detecta protocolo (`chrome-extension:` vs `http(s):`) pra
escolher URL absoluta de produção vs relativa. Manifest V3 bloqueia atributos inline (`onclick`
etc.) por CSP — todo `popup.js` usa `addEventListener`, diferente do `index.html` do site (que
usa inline livremente).

---

## 22. Convenções de Código

- IDs seguem `{prefix}-val`, `{prefix}-chg`, `{prefix}-sub`, `{prefix}-lock` — `renderMkt()`
  deriva o lock via `.replace(/-val$/, '-lock')`.
- Toda nova função de API externa precisa de espelho em `server.ps1` **e** em `api/*.js` —
  sincronizados manualmente. **Já causou bugs reais quando divergiram** (ver seção 3 — o bug do
  `[Math]::Min` e do pipeline "desenrolando" HashSets só existiam no lado PowerShell, mesmo com o
  JS correto).
- **Todo arquivo novo em `api/` usa `export default` (ES Module)** — nunca `module.exports`.
- Ao adicionar `WebClient` em `server.ps1` pra buscar texto externo, **sempre** setar
  `$wc.Encoding = [System.Text.Encoding]::UTF8`.
- Em PowerShell, `[Math]::Min`/`[Math]::Max` com um literal inteiro sem ponto decimal pode
  truncar o outro argumento se ele for `double` — **sempre escrever `5.0`, não `5`**, quando
  comparar com um valor fracionário (ver seção 3).
- Em PowerShell, **nunca** usar `@($x | ForEach-Object { FuncaoQueRetornaColecao $_ })` esperando
  um array de coleções — o pipeline desenrola cada coleção retornada. Usar um loop explícito com
  `.Add()` (ver seção 3).
- Ao adicionar um gráfico novo que deveria ter seleção manual de intervalo, **lembrar de incluir
  `events: [...]` com `mousedown`/`mouseup`** na config do Chart.js (seção 8.3).
- Ao misturar ativos de bolsas/fusos diferentes num índice ponderado, **alinhar por dia
  calendário** (`toISOString().slice(0,10)`), nunca por timestamp bruto (seção 13.2).
- Se um treemap novo tiver células ilegíveis (muito finas), aplicar raiz quadrada no valor de
  tamanho antes de passar pro `computeTreemap` (seção 10.2).
- Ao criar uma linha/tabela com 3+ colunas numa área que também tem um cabeçalho próprio, usar
  **CSS Grid com `grid-template-columns` idêntico** no cabeçalho e nas linhas, não `flex` com
  `justify-content: space-between` — flex com número de filhos diferente entre cabeçalho e linha
  desalinha as colunas (seção 13.5).
- Palavras-chave em inglês: considerar se a forma **plural** também precisa entrar na lista — o
  filtro usa fronteira de palavra literal (`\btermo\b`), sem stemming (seção 15.1.3).
- **Emojis foram removidos dos textos/labels gerados por JS** na repaginação — não reintroduzir
  em strings novas (títulos de card, mensagens, badges) a menos que pedido explicitamente; o
  padrão visual atual é texto puro.
- Prefira modais discretos (botão "metodologia"/"fontes") a bloquear o topo de uma aba com um
  banner de aviso permanente e grande — lição aprendida ao encolher o disclaimer de NOTÍCIAS
  (seção 15.1.10). Ainda vale manter avisos permanentes pequenos e realmente essenciais (ex:
  `.etf-disclaimer` dos ETFs Internos).
- **Comparar "em qual dia de calendário isso aconteceu" entre ativos de bolsas diferentes exige o
  fuso de CADA bolsa, não um corte único** (ex: horário de Brasília) — testado ao vivo na seção
  6.8: um índice asiático já tem a barra "de hoje" à noite anterior em horário de SP, e uma barra
  de câmbio publicada perto da meia-noite UTC cai num dia ou noutro dependendo do horário de
  verão europeu. Usar `dateKeyTZ(ts, meta.exchangeTimezoneName)` (chave `'YYYY-MM-DD'` via
  `Intl.DateTimeFormat` com a tz certa) e comparar as chaves como string — refina a lição da
  seção 13.2 (que já valia pra alinhar por dia calendário, mas assumia um fuso só).
- **Não assumir que "depois de tal horário" significa "todo instrumento já fechou"** — Brent,
  Ouro, Bitcoin e câmbio negociam bem depois do fechamento das bolsas de ação (seção 6.8). Pra
  saber se a última barra é definitiva, checar `meta.currentTradingPeriod.regular` (mesmo campo
  da seção 7) e descartar a barra enquanto a sessão daquele ativo especificamente ainda está
  aberta — não uma hora de corte fixa pra todos.
