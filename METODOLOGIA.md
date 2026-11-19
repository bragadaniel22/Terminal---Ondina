# Terminal Financeiro — Metodologia e Documentação Técnica

> Documento de handoff completo — suficiente para qualquer sessão nova (Claude ou humano)
> entender o projeto do zero e continuar o trabalho sem perguntar de novo o que já foi decidido.
> **Reescrito 100% numa sessão anterior** pra refletir uma repaginação completa de design + uma
> reforma grande da aba NOTÍCIAS (fontes, nota de relevância, classificação por assunto,
> notificações). **Atualizado (não reescrito) numa sessão mais recente** que adicionou a sub-aba
> FECHAMENTO (relatório de fechamento de mercado, seção 6.8, com NTN-B saindo de uma planilha
> mantida à mão — seção 6.8.1), um botão de exportar o relatório como imagem (seção 6.8.2), duas
> otimizações de carregamento inicial (seção 22), e um projeto irmão fora do deploy do Vercel que
> manda esse relatório por WhatsApp em horário agendado (seção 6.8.3).
> Se você está lendo isso numa conversa nova, **leia até o fim antes de tocar em qualquer código**.

---

## 0. Status Atual (leia isto primeiro)

**Abas do terminal (7, nessa ordem):** ÍNDICES, SINGLE NAMES, PORTFÓLIO, SETORES, HEATMAP,
NOTÍCIAS, BONDS. BONDS é a mais nova (sessão bem posterior à repaginação abaixo — ver seção
16.2 pra tudo em detalhe).

### ⚠️ O MAIS IMPORTANTE: o projeto está no plano PRO (desde 18/11/2026)

A conta Hobby foi **pausada em 11/11/2026** por estourar as 4h de Fluid Active CPU, e o
despause não é automático. O Daniel assinou o **Pro (US$ 20/mês)**, o que resolveu na hora.

Isso muda premissas que ditaram muita decisão de arquitetura no passado:

| | Hobby | Pro |
|---|---|---|
| **Funções em `api/`** | **teto de 12** | **sem teto** |
| Cron | 1x/dia, ±59min | **1x/minuto, preciso** |
| Duração máx. | 300s | 800s |
| Memória | 2 GB | 4 GB / 2 vCPU |

**O teto de 12 funções acabou.** Ele é a razão de vários endpoints terem sido fundidos no
passado (`b3.js` absorveu `di-history.js`, etc.). Endpoint novo não precisa mais ser espremido
dentro de um existente — mas **as fusões antigas ficam como estão**, não há motivo pra desfazer.

Consumo medido antes das otimizações: ~US$ 1,21/mês de recursos medidos contra US$ 20 de
crédito. Existe um orçamento de **US$ 5 em Spend Management, mas só com notificação — não
pausa nada**. Se quiser freio de verdade, tem que ligar "Pause production deployments".

### O que entrou em 18-19/11/2026
- **Ficha da empresa** (seção 23): clicar num resultado de busca abre uma página de detalhe do
  ativo — múltiplos, alvo de analistas, histórico de resultados, detentores, perfil.
- **Busca rápida** (seção 24): botão "Buscar" com lupa no cabeçalho (e Ctrl+K no desktop), que
  consulta o catálogo do terminal **e o Yahoo**, então acha qualquer ticker do mundo.
- **Comparação de ativos** (seção 25): sobrepor até 4 ativos no mesmo gráfico, em base 100.
- **Captura de NTN-B por cron na Vercel** (seção 26) — substitui a tarefa do PC do Daniel.
  **Depende de uma variável `CRON_SECRET` que ainda não foi criada**; enquanto isso não for
  feito, a função responde 401 a tudo e o histórico fica congelado.
- **Bug grave corrigido**: a planilha da NTN-B tinha inchado pra **1 GB** por um tema corrompido
  (seção 26.1). O histórico migrou pra JSON e o Excel virou arquivo congelado.
- Single Names: **Visa e TSMC removidas**, ASML ganhou datas de entrada, ouro ganhou 3ª tranche.
  **VIX** entrou no card Bolsa US.

### Repaginação completa de design (essa sessão)
O terminal deixou de ser um "terminal escuro estilo Bloomberg" e virou um **app claro,
profissional, estilo fintech moderna** — mudança de design puro, toda a lógica/JS ficou
**idêntica** (confirmado por diff linha a linha do `<script>` inteiro na hora da migração — só
mudou indentação, cores de gráfico e remoção de emojis dos textos gerados via JS). O usuário deu
um HTML de referência pronto (gerado por ele/outra ferramenta) e pediu pra virar "a nova base do
terminal"; copiamos o arquivo inteiro por cima do `index.html` depois de validar a integridade.

- **Tipografia**: `IBM Plex Sans` (textos/labels) + `JetBrains Mono` (números, com
  `font-variant-numeric: tabular-nums`) — carregadas via Google Fonts (`<link>` no `<head>`,
  **primeira dependência de rede externa pro CSS/fontes** do projeto; precisa de internet pra
  renderizar com a fonte certa, cai pro fallback do sistema sem internet).

  **Fonte mono trocada numa sessão seguinte** — era `IBM Plex Mono` originalmente. O Daniel
  reportou que o "0" ficava parecido com "8" na extensão de Chrome (números pequenos, peso
  700/bold). Tentativas descartadas: `font-variant-numeric: slashed-zero` e todas as variantes
  `ss01`-`ss08` não mudam nada — Google Fonts entrega essas duas fontes sem os recursos
  OpenType de zero alternativo, então o CSS não tem efeito nenhum (testado ao vivo, sem
  diferença visual). Passo intermediário (revertido depois): reduzir `.rval` de peso 700 pra
  600 melhorava a distinção mas não resolvia de vez. **Solução final**: trocar pra
  `JetBrains Mono`, que tem um **ponto dentro do zero no glifo padrão** (não é recurso
  OpenType opcional, é o desenho normal da fonte) — confirmado visualmente até no tamanho real
  de 13-16px. Com a fonte certa, `.rval` voltou pro peso 700 original (a muleta do peso não era
  mais necessária). Trocada em **todo lugar** que citava a fonte mono por nome literal, não só
  a variável CSS — inclusive dentro dos `font: { family: ... }` do Chart.js e do desenho em
  `<canvas>` do botão "baixar imagem" (seção 6.8.2), que não usam a variável `--mono`.
- **Paleta**: header/rodapé em navy escuro (`--ink: #0f172a`), corpo **off-white** (não branco
  puro — ver variáveis exatas na seção 4), acento azul forte (`--accent: #1d4ed8`) em links,
  bordas de foco e no logo.
- **Abas e filtros**: viraram pílulas (`background: var(--ink)` quando ativo, cantos
  arredondados) em vez de texto sublinhado.
- **Emojis decorativos removidos** de textos/labels (bandeiras, ícones de card, 🔒/🤖/⭐/🔔/✕/🔍
  etc. em strings geradas por JS) — mantidos só como texto puro. `.sn-search-btn`, `.modal-close`
  e `.feed-search-icon` ficaram com o elemento HTML vazio (sem glifo/emoji dentro), com a
  intenção de desenhar o ícone só em CSS.

  **Bug real numa sessão seguinte**: essa intenção nunca foi implementada de fato — o CSS desses
  três só definia cor/fundo, sem nenhum `::before`/`::after` desenhando algo. Resultado: os três
  ficavam **completamente em branco** (nem X, nem lupa, nada), não só "meio claros" — o botão de
  fechar dos modais em particular ficava quase invisível contra o fundo do card. Corrigido
  desenhando os ícones com pseudo-elementos (`::before`/`::after`, `content: ''`, formas via
  `border-radius`/`transform: rotate()`, cor via `currentColor` — herda automaticamente a cor do
  `:hover` já existente, sem CSS extra): X (duas barras cruzadas) em `.modal-close`, lupa (aro +
  cabo) em `.sn-search-btn` e `.feed-search-icon`. Continua sem emoji/glifo de texto, só que agora
  o CSS de fato desenha algo. **Se um ícone novo desse tipo for adicionado, não repetir o erro de
  deixar o elemento vazio sem o CSS correspondente** — testar visualmente antes de assumir que
  "só CSS" está funcionando.
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
acompanha, calculado on-demand sem cron nem storage. `api/ntnb.js` ganhou um modo `?dates=`
multi-data (na época, sem gastar slot novo do teto de 12) — `api/anbima.js` teve um modo equivalente
adicionado e **depois removido** na mesma sessão, ver parágrafo abaixo. Ver seção 6.8 pra tudo em
detalhe, incluindo dois bugs de fuso horário reais encontrados e corrigidos antes de publicar
(data errada pra mercados asiáticos e câmbio com um corte ingênuo de epoch, e a suposição errada
de que todo instrumento já fecha às 19h de Brasília — Brent/Ouro/câmbio negociam depois disso).
Relatório inclui os 6 vencimentos de NTN-B (seção 6.8.1) e **não inclui Bitcoin** (removido a
pedido do usuário — continua normal no card ao vivo e no Heatmap). Tem também um botão "baixar
imagem" que exporta o relatório como PNG desenhado num `<canvas>`, sem dependência nova de CDN
(seção 6.8.2).

**Cinco instrumentos removidos do relatório de Fechamento nessa mesma sessão, a pedido do
usuário**: ETTJ PRÉ, DOW JONES, DAX, NIKKEI 225 e KOSPI (os dois últimos eram toda a região "Ásia
e Pacífico" do relatório — ela deixou de aparecer). O card ETTJ ao vivo (sub-aba HOJE) **não foi
afetado**. Isso deixou órfão e já removido: `closingEttjDeltas()` no front-end, o branch `?dates=`
inteiro de `api/anbima.js` (só existia pra essa entrada) e `Get-EttjNear` no espelho
`server.ps1` — ver seção 6.8 pro detalhe exato do que ficou e do que saiu. **Não recriar nenhum
desses 5 itens sem pedido explícito.**

**Δ mês/Δ ano da NTN-B vêm de uma planilha mantida à mão** (`Taxas Antigas NTNB.xlsx`, raiz do
repo), não mais de busca ao vivo — a ANBIMA não retém histórico suficiente pra base de Δ ano (ver
seção 6.8.1). O Daniel precisa atualizar essa planilha manualmente (1x/mês, no fim do mês; 1x/ano,
31/dez) — ver pendência 8 abaixo.

**Novo projeto irmão: `Envio Fechamento WhatsApp/`** (fora do deploy do Vercel, pasta separada na
raiz de `R:\X - Daniel\Claude\`) — script Node.js local que tira um screenshot da sub-aba
FECHAMENTO do site publicado e manda por WhatsApp em horário agendado. Depende de seletores CSS
estáveis do relatório (`.subtab-btn[data-sub="close"]`, `.close-table`, `.close-status`,
`.close-report`, `#close-refdate`) — ver seção 6.8.3, **mudar esses seletores/IDs quebra o
projeto de WhatsApp sem avisar**.

> **Ideia dormente (NÃO ativa, não implementar sem pedido explícito) — ver seção 6.8.4**: mover
> esse envio pra depender só do Vercel (Cron + função serverless com canvas em Node em vez de
> Puppeteer, sessão do Baileys guardada num KV externo tipo Upstash), pra funcionar mesmo com o
> PC do Daniel desligado. Guardada só pra não perder a ideia, discutida numa sessão anterior.

**As abas BUSCAR e CNBC (BETA) foram REMOVIDAS** (não pausadas, removidas de vez) a pedido do
usuário — "CNBC não faz sentido, já temos o portal na parte de notícias". A busca de ativos foi
preservada e movida pra dentro de SINGLE NAMES. Ver seções 14 e 15.

**A aba BONDS (BETA) foi REMOVIDA**, por cota diária esgotada persistente na API paga do
bondterminal.com. Ver seção 16 (histórico).

**A aba SIMULADOR (Markowitz) foi REMOVIDA** a pedido do usuário. `SIMULADOR_METODOLOGIA.md`
continua no repo só como registro histórico da matemática. Ver seção 12.

**Pendências / decisões em aberto:**

0. 🔴 **`CRON_SECRET` não foi criada** — a captura automática de NTN-B (seção 26) responde 401 a
   tudo e **o histórico está congelado em 17/11/2026**. Pior: a tarefa do Windows ainda grava na
   planilha, que deixou de ser lida. É a pendência mais urgente do projeto.
0.1. **Sobrou um arquivo de 1 GB no disco do Daniel**: `Taxas Antigas NTNB.CORROMPIDA.bak`
   (fora do repo). Pode apagar — os dados estão na planilha corrigida e em
   `backup-ntnb-dados.json`. Ver seção 26.1.
0.2. **`/api/company` e `/api/cron-ntnb` não estão no `server.ps1`** — dão 404 no dev local.
   Decisão consciente (ver seção 27), não esquecimento.
1. **`GEMINI_API_KEY`** está configurada no Vercel para o botão "resumir com IA". Localmente,
   `$env:GEMINI_API_KEY`.
2. ~~**Otimização de chamadas de API não implementada.**~~ **Feito em 10/11/2026**, depois de a
   cota de CPU do plano grátis estourar (103%, conta a ser pausada em 24h): lote de cotações
   numa invocação só, cache de CDN em todos os endpoints, cache em memória no `ai-news` e pausa
   por inatividade. **Ver seção 18.0** — é a leitura obrigatória antes de mexer em `api/yahoo.js`
   ou em qualquer `Cache-Control`.
3. **Dados institucionais Reuters/LSEG**: pergunta em aberto de longa data, sem resposta se o
   usuário tem acesso via RDP (funcionaria) ou só Workspace (não funcionaria remotamente).
4. **`api/summary.js`** (resumo diário de IA via OpenAI) é órfão — primeira tentativa, substituída
   pelo resumo por notícia individual via Gemini. **Ainda está no repo** (14 arquivos em `api/`
   hoje — ver seção 2), só não é chamado pelo front-end. Pode ser removido sem risco; deixou de
   ser urgente desde o Pro, que não tem teto de funções.
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
9. **[RESOLVIDO numa sessão seguinte] Horário de publicação do arquivo diário da ANBIMA
   (NTN-B)**: não tem SLA público oficial, mas o header `Last-Modified` do próprio arquivo,
   testado em 4 dias distintos, aponta consistentemente **entre 18h25 e 18h45 de Brasília**. Ver
   seção 6.7 pro método e a ressalva sobre dois dias com padrão diferente.
10. **`Taxas Antigas NTNB.xlsx` precisa de manutenção manual recorrente** (1x/mês, no último dia
    útil do mês; 1x/ano, 31/dez) — é a base de Δ mês/Δ ano da NTN-B no relatório de Fechamento, e
    se ficar desatualizada o Δ correspondente vira "n/d" sozinho (não mostra número errado, mas
    também para de mostrar o número certo). Ver seção 6.8.1 pra estrutura exata do arquivo.
11. **Otimizações de carregamento inicial identificadas e corrigidas nessa sessão** (Chart.js
    bloqueava a renderização da página inteira; `loadBrasil()`/`loadJuros()` faziam 3 chamadas em
    série sem necessidade) — ver seção 22. Ainda não implementada: a otimização maior de
    consolidar chamadas de ticker do Yahoo (pendência 2 acima).
12. **"TBILL 12-nov-26" (aba BONDS) continua sem preço e sem yield** — não é fundo, não é
    duplicata de nenhum outro papel (sem alias disponível), e ainda não foi resolvido. Ver seção
    16.2.7 pra lista completa e 16.2.3 pro mecanismo de alias, caso vire uma duplicata depois.
13. **Regra de "qual cotação é a oficial" pra papéis duplicados por dealer (aba BONDS) não
    existe** — cada linha da planilha aparece como entrada própria, sem dedup. Ver seção 16.2.3.
14. **Pasta órfã `Bonds Terminal/`** (raiz do repo, sobra do primeiro upload da aba BONDS, antes
    do código passar a esperar a planilha solta na raiz) — pode ser apagada do GitHub sem risco,
    ver seção 2.

---

## 1. Visão Geral

**Terminal Financeiro** é um dashboard financeiro construído como uma **única página HTML**
(`index.html`) com JavaScript puro, CSS embutido, sem frameworks front-end (só uma dependência de
CDN pro Chart.js e outra pras fontes Google, ver seção 4). Os dados vêm de APIs públicas,
proxiadas por **Vercel Serverless Functions** (`api/`) pra contornar CORS. Uso real: até ~6
pessoas (Daniel + colegas).

Sete abas:
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
- **BONDS** — ~69 papéis de renda fixa (soberano BR, corporativos, bancos, preferenciais, fundos
  de bonds), agrupados por região, com cupom/duration/bid yield/spread do dia, histórico de
  yield e preço, e comparação opcional contra treasuries americanos — ver seção 16.2. Criada numa
  sessão bem posterior à remoção da BONDS (BETA) original (parágrafo abaixo); sem relação de
  código, fonte de dados ou implementação com aquela tentativa.

~~**SIMULADOR**~~, ~~**BUSCAR**~~ e ~~**CNBC (BETA)**~~ — todas **removidas** em sessões
anteriores. Ver seções 12, 14 e 15 pro histórico de cada uma. **Não recriar nenhuma sem pedido
explícito do usuário.** (A antiga ~~**BONDS (BETA)**~~ também foi removida — seção 16 — mas
**foi recriada** numa sessão seguinte com fonte de dados totalmente diferente; ver seção 16.2,
já ativa hoje.)

Além do site, existe uma **extensão de Chrome** (pasta `chrome-extension/`, não faz parte do
deploy do Vercel) com um popup replicando ÍNDICES (5 principais), SINGLE NAMES e BUSCA — **também
repaginada nessa sessão** pro novo visual claro (seção 21). Ainda não reflete ETFs Internos nem
NOTÍCIAS — trabalho novo se quiserem isso na extensão.

Também existe, **fora dessa pasta** (irmã dela, em `R:\X - Daniel\Claude\Envio Fechamento
WhatsApp\`), um projeto Node.js separado que tira screenshot da sub-aba FECHAMENTO do site
publicado e manda por WhatsApp em horário agendado — não faz parte do deploy do Vercel, roda
localmente no PC do Daniel. Tem seu próprio `README.md` com todo o setup. Ver seção 6.8.3 pra
como ele depende do HTML do relatório de Fechamento.

---

## 2. Arquitetura de Arquivos

```
/
├── index.html                     # Aplicação completa (HTML + CSS + JS embutidos)
├── package.json                   # { "type": "module" } — OBRIGATÓRIO pro Vercel (ver seção 19); dependências `ws` (seção 6.1.1) e `xlsx` (lê a planilha abaixo, seção 6.8.1)
├── vercel.json                    # Configuração de deploy no Vercel. Ver seção 19 sobre `functions.api/ntnb.js.includeFiles` (garante que a planilha .xlsx vá junto no bundle da função)
├── favicon.ico                    # Favicon (16px + 32px, PNG-in-ICO) — logo ANTIGA, não atualizada na repaginação
├── server.ps1                     # Servidor local de desenvolvimento (PowerShell)
├── vercel-usage.ps1                # Script local p/ monitorar uso/custo do Vercel via API
├── launch.json                    # Config do preview server do Claude Code (autoPort: true)
├── METODOLOGIA.md                 # Este arquivo — visão geral de todo o terminal
├── PALAVRAS_CHAVE_NOTICIAS.md     # Lista completa de KEYWORDS/EXCLUDE_KEYWORDS da aba NOTÍCIAS, extraída do código — pode ficar desatualizada se a lista mudar de novo sem regenerar este arquivo
├── SIMULADOR_METODOLOGIA.md       # [HISTÓRICO] fórmulas do Simulador — aba removida, feature não existe mais
├── Bonds Carteira.xlsx            # [ÓRFÃO] planilha do usuário — fonte da extinta aba BONDS, sem uso agora
├── Taxas Antigas NTNB.xlsx        # Base de Δ mês/Δ ano da NTN-B no relatório de Fechamento — mantida À MÃO pelo Daniel (seção 6.8.1). PRECISA estar no repo/deploy, não é órfã
├── Bonds Terminal.xlsx            # Fonte da aba BONDS (nova, seção 16.2) — mantida À MÃO pelo Daniel. PRECISA estar na RAIZ (não numa subpasta — ver seção 16.2.1 sobre a confusão real que isso já causou em produção)
├── assets/                        # Logo/favicon fonte
│   ├── icon.svg                  # Logo vetor NOVA (quadrado azul arredondado + check branco) — trocada nessa sessão
│   ├── icon-16.png, icon-32.png, icon-192.png, icon-512.png   # PNGs — AINDA COM A LOGO ANTIGA (raster, não regenerado)
├── chrome-extension/               # Extensão de Chrome — NÃO faz parte do deploy Vercel
│   ├── manifest.json             # Manifest V3
│   ├── popup.html                # Redesenhado nessa sessão pro visual claro/IBM Plex — ver seção 21
│   ├── popup.js                   # JS inalterado na repaginação
│   ├── icons/                    # ícones próprios (16/32/48/128px) — AINDA COM A LOGO ANTIGA
│   └── README.md                 # passo a passo de instalação
├── server.js                       # Servidor Node único que monta os MESMOS api/*.js sem alterá-los — pra hospedar FORA da Vercel (Render/Fly). Ignorado no deploy da Vercel pelo .vercelignore. Ver seção 27
├── .vercelignore                   # Mantém server.js e scripts/ fora do deploy da Vercel; data/ VAI (é fonte de dados)
├── scripts/                        # Rodam em tempo de build, nunca em requisição
│   ├── build-bonds.mjs           # "Bonds Terminal.xlsx" → data/bonds.json (seção 16.2.1)
│   └── build-ntnb.mjs            # "Taxas Antigas NTNB.xlsx" → data/ntnb-historico.json (seção 26.1)
├── data/                           # Dados prontos, lidos pelas funções
│   ├── bonds.json                # Gerado no build; api/bonds.js cai no .xlsx se faltar
│   └── ntnb-historico.json       # FONTE DE VERDADE do histórico de NTN-B — versionado no repo
└── api/                            # 14 arquivos — o teto de 12 era do Hobby e NÃO existe mais no Pro
    ├── yahoo.js                   # Proxy Yahoo Finance v8 chart (preço + histórico). Aceita &interval= e VÁRIOS tickers por vírgula (lote, seção 18.0.1). Fallback de fechamento anterior pra commodities/futuros (seção 6.6.1)
    ├── company.js                 # Ficha da empresa: 10 módulos do quoteSummary numa chamada (seção 23)
    ├── cron-ntnb.js               # Captura diária de NTN-B agendada, grava no GitHub (seção 26)
    ├── target.js                  # Proxy Yahoo Finance quoteSummary (price targets — crumb auth)
    ├── quote-search.js            # Resolve texto livre → ticker(s) candidato(s) — usado pela busca de ativos em SINGLE NAMES e pela busca rápida (seção 24)
    ├── anbima.js                  # Proxy ANBIMA ETTJ (POST). Sem ?dates= → snapshot do dia; ?dates=DD/MM/YYYY,... → multi-data (relatório de Fechamento, seção 6.8)
    ├── b3.js                      # Cotação B3 (fallback TradingView) + histórico DI Futuro. ?s=X → cotação; ?s=X&history=1 → histórico
    ├── bonds.js                   # Aba BONDS (nova, seção 16.2): snapshot de "Controle Duration" + histórico de yield/preço/treasury de "Bonds Terminal.xlsx"
    ├── rates.js                   # Taxas de referência: ?source=ecb | selic | cdi12m (substituiu o antigo ecb.js)
    ├── treasury.js                # Yield de treasuries via TradingView. ?symbol=TVC:US02Y; &history=1 → histórico
    ├── ntnb.js                    # Snapshot + histórico NTN-B. Sem query → snapshot; ?days=N → histórico; ?dates=DD/MM/YYYY,... → datas específicas (Δ dia); ?staticAnchors=1 → lê "Taxas Antigas NTNB.xlsx" (Δ mês/Δ ano, seção 6.8.1)
    ├── news.js                    # Notícias por ticker + resumo por IA. ?t=TICKER&n=Nome → filtra por relatedTickers/título (seção 23.5); ?action=summarize&url=... → resumo Gemini
    ├── ai-news.js                 # Aba NOTÍCIAS: recorte por palavra-chave, 12 fontes, classificação por assunto, nota de relevância — seção 15.1
    └── summary.js                 # [ÓRFÃO] resumo diário via OpenAI, não usado pelo front-end (pendência 4 da seção 0)
```

`api/cnbc-news.js` e `api/bonds-history.js` **foram apagados** nas remoções das abas CNBC e
BONDS (a antiga, seção 16 — sem relação com o `api/bonds.js` atual, criado do zero numa sessão
bem posterior com fonte de dados totalmente diferente, ver seção 16.2). `api/di-history.js`,
`api/ntnb-history.js` e `api/summarize-news.js` **foram fundidos** em
`b3.js`/`ntnb.js`/`news.js` respectivamente, pelo motivo descrito na seção 19.1.1 (limite de 12
funções do plano Hobby).

Arquivos na raiz que **não pertencem ao site em produção**: `CONTEXT.md`, `terminal-financeiro.html`,
`PLANEJAMENTO APP PROJETO.md`, `Terminal financeiro logo.zip`, `Terminal-Financeiro-Extensao.zip`,
`Thumbs.db`, `Bonds Carteira.xlsx` (órfã desde a remoção da aba Bonds antiga). **`Bonds Terminal/`**
(subpasta, não confundir com o arquivo `Bonds Terminal.xlsx` da raiz) também é órfã — sobrou de
uma tentativa inicial de upload que colocou a planilha numa subpasta; hoje só guarda a cópia de
trabalho do Daniel e `papeis_sem_precos.txt` (lista de referência gerada por análise, não lida
por nenhum código — ver seção 16.2.7). Pode ser apagada sem risco.

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
--mono: 'JetBrains Mono', Consolas, Monaco, monospace;                    /* números */
```
Carregadas via Google Fonts (`<link>` no `<head>`, com `preconnect`) — **dependência de rede
externa nova**; sem internet, cai pro fallback do sistema (ainda funciona, só não fica idêntico).
`html { font-variant-numeric: tabular-nums; }` garante que números fiquem alinhados em coluna
(dígitos de largura fixa) mesmo em fontes proporcionais. **`--mono` trocou de `IBM Plex Mono`
pra `JetBrains Mono` numa sessão seguinte** (zero parecendo oito — ver seção 0 pro raciocínio
completo e as tentativas descartadas antes da fonte).

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
publicação em si acontece depois disso, sem SLA oficial documentado publicamente pela ANBIMA.

**Horário real de publicação, descoberto numa sessão seguinte**: o arquivo diário
(`ms{aa}{mm}{dd}.txt`, mesmo usado pelo card e pelo relatório de Fechamento — seção 6.8.1) expõe
um header HTTP `Last-Modified` no próprio servidor da ANBIMA. Testado em 4 dias distintos de uma
mesma semana (11/08, 10/08, 07/08, 05/08/2026): todos publicados **entre 18h25 e 18h45 de
Brasília**, uns 30-45min depois do fechamento do pregão de DI Futuro (18h, seção 6.8.4/B3) — não é
um SLA oficial da ANBIMA, mas é um sinal real e repetível direto do servidor deles, não uma
suposição. **Ressalva**: em dois dias testados (04/08 e 06/08), o `Last-Modified` bateu quase no
segundo com o do dia seguinte (05/08 e 07/08) — parece reprocessamento em lote nesses casos
específicos, não o padrão normal; tratar "18h30-18h45" como janela típica, não garantia diária.
Forma de checar de novo se precisar: `curl -I https://www.anbima.com.br/informacoes/merc-sec/arqs/ms{aa}{mm}{dd}.txt`
e ler o header `Last-Modified` (o arquivo do dia atual só existe — HTTP 200 — depois de
publicado; antes disso o servidor devolve 404).

### 6.8 Sub-aba FECHAMENTO — relatório de fechamento de mercado
A aba ÍNDICES ganhou duas sub-abas em pílula logo abaixo do seletor de abas: **HOJE** (o conteúdo
descrito acima, inalterado) e **FECHAMENTO** (`switchIndicesSub()`, lazy-load via flag
`closeReportLoaded`, igual ao padrão de `switchTab()`). Relatório único no estilo "fechamento de
mercado" de banco (Fechamento · Δ dia · Δ mês · Δ ano), agrupado em Renda Fixa / Bolsa /
Commodities / Câmbio, com subcategoria de região dentro de Bolsa (Brasil, Estados Unidos, Europa,
Ásia e Pacífico, Emergentes). Config declarativa em `CLOSE_REPORT_CONFIG` (mais os 6 vencimentos
de NTN-B gerados a partir da constante `NTNB_MATURITIES` já existente — ver seção 6.8.1).

**Bitcoin não entra nesse relatório** (removido a pedido do usuário) — continua normalmente no
card ao vivo "Commodities & Cripto" da sub-aba HOJE e no Heatmap; a seção do relatório de
Fechamento por isso chama-se só "Commodities", sem "e Cripto".

**Cálculo on-demand, sem cron nem storage.** Cada clique em FECHAMENTO recalcula na hora (com
cache em `localStorage` chaveado pela própria data de referência — reabrir no mesmo "dia de
mercado" não refaz as ~20 chamadas). Fica fora do ciclo de 60s do `loadAll()`, de propósito.

**Data de referência (`computeRefKey()`)**: string `'YYYY-MM-DD'` calculada a partir da hora de
São Paulo via `Intl.DateTimeFormat` (nunca o fuso do navegador — tem colega acessando de fora do
Brasil). Antes das 19h em SP (ou fim de semana) recua pro último dia útil. **Isso não assume que
todo instrumento já fechou às 19h** — Brent/Ouro/câmbio negociam depois disso — quem resolve isso
é o filtro de barra parcial abaixo, não a hora de corte em si.

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
- **9 tickers via Yahoo** (`fetchYahooChartRaw(ticker, '2y')`) — usa **`close`**, não `adjclose`
  (o relatório mostra nível de fechamento; misturar nível de `close` com delta de `adjclose`
  seria inconsistente). Único caso onde isso importa de fato: MSCI EM é o ETF `EEM`, então o Δ
  ano ali é retorno de preço, não retorno total do índice — não usar esse número pra comparar com
  o índice MSCI EM oficial.
- **2 DI Futuro** via `/api/b3?s=..&history=1` (mesmo endpoint da seção 6.1.1, ~2 anos de
  histórico), chave de data em `America/Sao_Paulo` (não tem `currentTradingPeriod`, então só o
  filtro 1 se aplica — funciona porque o filtro de refKey já exclui a barra de hoje enquanto ela
  ainda está em formação).
- **6 vencimentos de NTN-B** — ver seção 6.8.1.

**[REMOVIDO desta sessão] ETTJ Pré, Dow Jones, DAX, Nikkei 225 e Kospi (os dois de Ásia e
Pacífico) saíram do relatório de Fechamento**, a pedido do Daniel — o card ETTJ ao vivo (HOJE)
**não foi afetado**, só a entrada do relatório. Removido também o código que só existia pra essa
entrada: função `closingEttjDeltas()` (front-end), branch `?dates=` de `api/anbima.js` e a função
`Get-EttjNear` do espelho em `server.ps1` (o modo snapshot de `api/anbima.js`, usado pelo card ao
vivo, e `Get-EttjOneDay`/`Get-BusinessDaysBack`, usados também pela NTN-B, continuam intactos). A
seção "Ásia e Pacífico" de Bolsa simplesmente não aparece mais no relatório (nenhum item restante
usa essa região) — não recriar nenhum desses 5 itens sem pedido explícito.

**Limitação real e permanente**: a ANBIMA só retém ~5-6 meses de arquivo diário no endpoint da
NTN-B — testado ao vivo (11/08/2026): `27/02/2026` responde, `20/02/2026` e `30/12/2025` voltam
vazio. **Δ ano das NTN-B aparece como "n/d"** sempre que a base (31/dez do ano anterior) já saiu
dessa janela — na prática, de meados do ano até a virada. Δ dia e Δ mês não são afetados. Isso é
esperado, não é bug; o código degrada sozinho sem hardcode de data.

### 6.8.1 NTN-B no relatório de Fechamento
Os 6 vencimentos (2028/2029/2030/2032/2035/2045, mesma constante `NTNB_MATURITIES` do card NTN-B
da sub-aba HOJE — seção 8.2) entram em Renda Fixa/Brasil junto com DI Futuro.

**Δ dia continua ao vivo, igual a antes**: um único arquivo diário da ANBIMA (`ms{aa}{mm}{dd}.txt`)
já traz as 6 taxas de uma vez — `api/ntnb.js` tem um modo `?dates=DD/MM/YYYY,...` (mesma mecânica
de walk-back/timeout/limite de tentativas da ETTJ) que resolve os 6 vencimentos com só 2
requisições no total (hoje + ontem), via `fetchNtnbBatch()`. O resultado fica num lote
compartilhado (`ntnbBatchPromise`) que os 6 itens `kind:'ntnb'` de `CLOSE_REPORT_CONFIG` esperam
via `await` — dispara uma vez só, não uma vez por vencimento. Espelho em `server.ps1`
(`Get-NtnbDayFile`/`Get-NtnbNear`), inserido **antes** do bloco de snapshot existente na ordem das
rotas (uma requisição com `?dates=` sem `?days=` cairia por engano no snapshot antigo senão).

**Δ mês e Δ ano MUDARAM de fonte — não vêm mais de busca ao vivo.** Histórico da sessão:
1. Primeira tentativa: `?dates=` também pra base de MTD/YTD, igual à ETTJ. Funcionava pro mês,
   mas a base de YTD (31/dez do ano anterior) já tinha saído da retenção da ANBIMA na maior parte
   do ano.
2. Segunda tentativa: fallback pro CSV público do Tesouro Direto (Tesouro Transparente) pra achar
   a taxa de 31/dez. Resolvia só 4 dos 6 vencimentos (2030/2032/2035/2045 têm título equivalente
   lá; **2028 nunca foi ofertado no Tesouro Direto, e 2029 só existe como "Tesouro IPCA+" sem
   cupom, um título de estrutura diferente da NTN-B com cupom que a ANBIMA reporta** — misturar os
   dois dá número estruturalmente errado, não só aproximado). Essa versão foi **abandonada**.
3. **Versão atual**: o Daniel mantém uma planilha (`Taxas Antigas NTNB.xlsx`, raiz do repo) com 2
   abas — **"Mês Anterior"** e **"Ano Anterior"** — capturadas da ANBIMA enquanto o dado ainda
   estava disponível. Estrutura fixa: data de referência em `C2`, vencimento em `C5:C10` (texto
   tipo `"NTNB 2028"`), taxa em `D5:D10` (fração, ex. `0.0847` = 8,47%). Cobre **os 6 vencimentos**,
   inclusive 2028/2029 que nenhuma fonte pública (ANBIMA nem Tesouro Direto) mais tem.

**`api/ntnb.js?staticAnchors=1`** lê essa planilha com a lib `xlsx` (SheetJS, `XLSX.read`) e
devolve `{month: {date, rates}, year: {date, rates}}`. **Cuidado de encoding real encontrado**: o
espelho em `server.ps1` (`Get-NtnbStaticAnchors`) lê o `.xlsx` na unha (é um zip de XML por baixo)
e **não pode comparar contra o literal `"Mês Anterior"` escrito no próprio `.ps1`** — Windows
PowerShell 5.1 lê arquivo `.ps1` sem BOM usando o codepage do sistema, não UTF-8, e o "ê" do
literal vira `"MÃªs Anterior"` em tempo de execução, nunca batendo com o nome real extraído do
XML. Solução: identificar as abas por padrão (`-like 'Ano*'` vs. `-notlike 'Ano*' -and -like
'*Anterior'`), nunca pelo texto acentuado exato.

**Validação de atualidade** (`fetchNtnbBatch()` no front-end): antes de usar a planilha, compara
o **mês/ano** da data que ela traz com o mês/ano esperado pro refKey atual (não o dia exato — 31
dez pode não ter tido pregão, a planilha real veio com 30/12, e exigir o dia exato trataria isso
como desatualizado por engano). Se não bater, aquele Δ (mês ou ano, cada um checado
independente) vira **"n/d"** em vez de calcular contra o período errado. Isso significa: se o
Daniel esquecer de atualizar a planilha num mês, o sintoma é "n/d" aparecendo, não um número
sutilmente errado — degrada do jeito certo.

**Consequência prática**: essa planilha exige manutenção manual (pendência 10 da seção 0) — 1x/mês
(último dia útil) e 1x/ano (31/dez, enquanto a ANBIMA ainda tem o dado fresco). A aba "Mês
Anterior" da planilha, na prática, quase nunca é o gargalo (a ANBIMA tem retenção de sobra pra
~1 mês) — é a base de YTD que precisa da captura anual pra não sumir.

**Cache no front-end**: `getNtnbStaticAnchorsCached()` guarda o resultado por 1h em `localStorage`
(não permanente, diferente de outros caches do relatório — é um arquivo que o Daniel pode
atualizar a qualquer momento, então não faz sentido supor que nunca muda).

### 6.8.2 Baixar como imagem
Botão "baixar imagem" ao lado de "atualizar" no cabeçalho do card
(`downloadClosingReportImage()`). Desenha o relatório já carregado (`lastCloseReportPayload`) à
mão num `<canvas>` — cores, tipografia (IBM Plex, já carregada via Google Fonts) e colunas
replicando o card em tela — e baixa como PNG (`canvas.toBlob` + link temporário com `download=`).

**Decisão de não usar `html2canvas` (ou lib parecida)**: o projeto evita dependências de CDN além
das duas já existentes (Chart.js, Google Fonts — seção 4) por princípio de manter o app leve e
sem depender de infraestrutura de terceiros pra funcionar. Como o layout do relatório é tabular e
previsível, desenhar direto no canvas é inteiramente viável e evita esse novo ponto de falha
externo. `await document.fonts.ready` garante que a fonte web já esteja carregada antes de medir/
desenhar texto (sem isso, a primeira exportação da sessão podia cair no fallback do sistema).

**Divergências conhecidas vs. um relatório de fechamento de banco de verdade**: futuros de
commodities (`BZ=F`/`GC=F`) usam o bucket diário do Yahoo, não o preço de ajuste/settlement
oficial da bolsa (mesma ressalva já documentada na seção 6.6.1 pro card ao vivo). **Bitcoin foi
removido do relatório** (não entra mais, a pedido do usuário — seção 0) — a ressalva de
"fechamento de cripto é convenção do Yahoo" que existia aqui não se aplica mais a nada no
relatório atual. **ETTJ Pré também foi removida do relatório** (junto com Dow Jones, DAX, Nikkei
225 e Kospi — seção 6.8, a pedido do usuário); a ressalva de que "ETTJ Pré não existe em
relatórios desse tipo de banco" que existia aqui não se aplica mais.

### 6.8.3 Consumidor externo: `Envio Fechamento WhatsApp/`
Projeto Node.js separado (fora do deploy do Vercel, ver seção 2) que abre o site publicado via
Puppeteer, clica na sub-aba FECHAMENTO, espera carregar, e tira um screenshot do card — não
reimplementa nenhuma lógica do relatório, só fotografa o HTML renderizado. Depende de:
- `.subtab-btn[data-sub="close"]` — seletor pra clicar e abrir a sub-aba.
- `.close-table` (aparece) e `.close-status` (some) — condição de "terminou de carregar".
- `.close-report` — elemento fotografado (cabeçalho + tabela + nota de rodapé).
- `#close-refdate` — extrai a data de referência real pra usar na legenda da mensagem (**não**
  usa a data do relógio — já mandou uma legenda errada uma vez por causa disso, ver o README
  desse projeto).

**Se qualquer um desses seletores/IDs mudar de nome ou sumir, o script de WhatsApp quebra
silenciosamente** (timeout esperando `.close-table`, ou screenshot de elemento errado) — sem
nenhum teste automatizado ligando os dois projetos. Ao mexer na estrutura HTML do relatório de
Fechamento, checar esse projeto (`R:\X - Daniel\Claude\Envio Fechamento WhatsApp\lib\screenshot.js`).

Detalhes de biblioteca (WhatsApp), agendamento e troubleshooting ficam só no `README.md` desse
projeto, não duplicados aqui — resumo rápido: usa **Baileys** (não `whatsapp-web.js` — essa foi
tentada primeiro e abandonada por uma incompatibilidade ativa e não resolvida com a versão atual
do WhatsApp Web, confirmada ao vivo nessa sessão), sessão local persistida em `.baileys_auth/`
(QR Code só na primeira vez), e agendamento via Agendador de Tarefas do Windows chamando
`npm run send` (não um processo próprio ficando ligado).

### 6.8.4 [IDEIA DORMENTE — NÃO ATIVA] Envio sem depender do PC ligado
**Status: só uma ideia registrada, discutida numa sessão anterior. Não implementar nada disto sem
pedido explícito do usuário** — hoje o envio funciona (seção 6.8.3) mas só enquanto o PC do
Daniel estiver ligado no horário agendado, o que ele identificou como uma limitação real.

**Pergunta original**: dá pra fazer esse envio de forma gratuita, funcionando com o PC desligado,
usando o Vercel?

**Resposta discutida (não implementada)**: sim, mas exige trocar duas peças do pipeline, não só
mudar onde o script roda:
1. **Trocar o Cron do Windows por Vercel Cron** (gratuito no plano Hobby, suficiente pra 1x/dia).
2. **Trocar a captura via Puppeteer (Chrome de verdade) por desenho direto num canvas em Node**
   (reaproveitando a mesma lógica de `downloadClosingReportImage()` — seção 6.8.2 — portada pra
   uma lib tipo `@napi-rs/canvas`), porque rodar um Chromium inteiro dentro de uma função
   serverless no Hobby é pesado e frágil pro tempo/memória disponíveis.
3. **Persistir a sessão do Baileys num KV externo gratuito** (ex: Upstash Redis, integra nativo
   com Vercel) em vez do arquivo local `.baileys_auth/` — função serverless não tem disco
   persistente entre execuções. Isso exige **reautenticar o WhatsApp do zero** (novo QR Code)
   nesse formato novo.
4. ~~Consumiria 1 dos 2 slots de função serverless de folga no teto de 12 do Hobby.~~
   **Não vale mais**: no Pro não há teto de funções (seção 19.1.1).

Se essa ideia for retomada, começar revalidando esses 4 pontos (limites atuais do Vercel Cron/
Hobby podem ter mudado) antes de implementar.

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

> **Mudanças de composição em nov/2026**: **Visa saiu** (06/11, substituída por TSMC) e **TSMC
> saiu** (19/11), deixando **9 ativos**. Atenção: o ticker `TSM` **continua existindo** no
> projeto como holding do *AI Chips / Semis ETF* na aba SETORES, com peso de 19,76% — coisa
> totalmente diferente, não apagar junto.
>
> As datas de entrada (`SINGLES_ENTRY_DATES`) foram conferidas contra a tabela do Daniel em
> 19/11: **ASML passou a ter datas** (antes o "Desde o início" dizia "sem data de entrada
> cadastrada"), o **ouro ganhou uma 3ª tranche** e o **ETF de semicondutores uma 2ª**; Danaher
> ficou com uma só. Sempre que essa lista mudar, conferir a paleta de cores do gráfico "Desde o
> início" (seção 25) — ela precisa ter pelo menos tantas cores quanto o ativo com mais tranches.

### 9.1 Busca de ativos (herdada da extinta aba BUSCAR)
Card no topo da aba, acima da grade de equities: campo de texto livre (`asset-search-input`) que
resolve pra ticker via `/api/quote-search` e mostra cotação com gráfico clicável
(`runAssetSearch()`). Resultado aparece num card próprio (`asset-search-results-card`) que fica
oculto até a primeira busca. Mesma função que existia na sub-aba ATIVOS de BUSCAR, só realocada.

### 9.2 Gráfico e busca de notícias por ativo
Mesmo modal da seção 8. Botão (`.sn-search-btn`) abre notícias específicas daquele ativo via
`openTickerNews()` (modal dedicado, usa `/api/news?t=TICKER&n=Nome` — o nome importa muito pro
filtro, ver seção 23.5). `openTickerNews()` aceita um 3º argumento com a origem: vindo da ficha
da empresa, aparece um botão "Voltar para a ficha" (antes era um beco sem saída).

A busca rápida da seção 24 cobre o mesmo terreno com mais alcance, incluindo ativos fora do
terminal — a busca desta aba ficou por compatibilidade, não é mais o caminho principal.

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
`Bonds Carteira.xlsx` ficou órfã no repo.

**Recriada numa sessão bem posterior (ver seção 16.2)** — não usando bondterminal.com nem
nenhuma API paga. Fonte de dados nova: planilha `Bonds Terminal.xlsx` mantida manualmente pelo
Daniel (mesmo padrão já usado pra NTN-B). Sem relação de código com a implementação antiga —
tudo escrito do zero.

---

## 16.2 Aba BONDS

Nova aba (7ª, depois de NOTÍCIAS), criada numa sessão bem posterior à remoção da BONDS (BETA)
antiga (seção 16) — sem relação de código, dado ou fonte com aquela tentativa. Lista ~69 papéis
de renda fixa (soberano BR, corporativos BR e internacionais, bancos, preferenciais, fundos de
bonds) com cupom, duration, bid yield e spread over treasury do dia, agrupados por região, cada
um clicável pra abrir histórico de yield e/ou preço, com comparação opcional contra treasuries
americanos.

### 16.2.1 Fonte de dados: `Bonds Terminal.xlsx`

Mesmo padrão já usado pra NTN-B (seção 6.8.1): planilha na **raiz do repo**, mantida à mão pelo
Daniel, subida pelo fluxo normal de upload no GitHub. **Real confusão de deploy nessa sessão**:
a primeira versão do código esperava o arquivo dentro de uma subpasta `Bonds Terminal/Bonds
Terminal.xlsx` (o Daniel tinha organizado a planilha assim localmente) — mas ele subiu o
`.xlsx` solto na raiz do GitHub (como já faz com a NTN-B), gerando `ENOENT` em produção porque
`vercel.json`/`api/bonds.js` procuravam no caminho errado. **Corrigido trocando o código pra
esperar a raiz** (igual à NTN-B) em vez de pedir pro Daniel reorganizar o upload — a subpasta
`Bonds Terminal/` ficou órfã (seção 2).

Quatro abas usadas, todas mantidas manualmente pelo Daniel (sem API externa nenhuma):

| Aba | Conteúdo | Cobertura |
|---|---|---|
| **Controle Duration** | Foto do dia por papel: nome, ISIN, banco/dealer, volume, bid yield, cupom, duration, spread over treasury. Data de referência do snapshot inteiro na célula **D1** (serial do Excel). | Todos os ~69 papéis |
| **Bid Yield** | Histórico diário de bid yield, ~5 anos | 53 dos 69 (faltam os 15 Fundos de Bonds + TBILL — ver 16.2.7) |
| **Preços** | Histórico diário de preço (Bid Close), ~5 anos | 53 dos 69 (mesma lista da coluna anterior — ver 16.2.7) |
| **Treasury** | Histórico diário de yield de treasury americano por vencimento (3M/6M/1Y/2Y/3Y/5Y/7Y/10Y) | pra comparação, não por papel |

As três abas de histórico usam o **mesmo layout de blocos de 3 colunas** (rótulo | valor |
vazio) repetidos lado a lado — nome do papel (ou vencimento do treasury) na linha 1, alinhado
com a coluna de VALOR (não a de timestamp); ticker RIC na linha 2; uma linha de status
("#NOME?" ou "Updated at HH:MM:SS", resíduo de fórmula do Eikon que não resolve fora do
terminal de origem — inofensivo, o dado histórico abaixo é valor fixo) na linha 3; sub-cabeçalho
"Timestamp"/"Bid Yield Close" na linha 4. **"Preços" não tem a linha de status** — cabeçalho e
dados começam uma linha antes das outras duas (dados a partir da linha 4, não 5).

### 16.2.2 `api/bonds.js` — endpoints

```
GET /api/bonds                              → snapshot (Controle Duration) + data de referência
GET /api/bonds?history=yield&name=...       → histórico de Bid Yield
GET /api/bonds?history=price&name=...       → histórico de preço (PU)
GET /api/bonds?history=treasury&maturity=2Y → histórico de yield do treasury (3M/6M/1Y/2Y/3Y/5Y/7Y/10Y)
```

Snapshot devolve `{ asOf: "18/08/2026", bonds: [...] }` — `asOf` vem da célula D1 de "Controle
Duration" (ver 16.2.1). Cada item de `bonds` tem `section`
(ver 16.2.4) além dos campos crus da planilha. Localiza um bloco de histórico varrendo a linha 1
de cada aba em blocos de 3 colunas até achar o rótulo procurado (texto exato, trim) — sem
depender de posição fixa de coluna, então sobrevive a novos papéis sendo adicionados no meio ou
no fim da planilha.

Espelho completo em `server.ps1` (`Get-BondsSnapshot`/`Get-BondsBlockSeries`/
`Get-XlsxSheetMap`/`ConvertTo-XlsxCellMap`/`ConvertTo-ColLetter`/`ConvertTo-BrDateFromSerial`),
seguindo a Regra de ouro nº 3 (seção 2). Parse manual do `.xlsx` via zip/XML, igual à NTN-B
(`Get-NtnbStaticAnchors`) — sem depender de nenhuma lib de Excel no PowerShell.

### 16.2.3 Papéis duplicados por dealer + alias manual

Alguns papéis aparecem **2x** em "Controle Duration" com bancos/dealers diferentes mas o mesmo
ISIN (ex: "Banco do Brasil 26" banco C e "Banco do Brasil" banco B) — parecem ser cotações de
corretoras diferentes pro mesmo papel. Cada linha da planilha é tratada como uma **entrada
própria** no snapshot (não agrupamos por ISIN) — sem regra ainda de qual cotação é "a oficial",
mostra como vem. XP 29/XP 29 2, Santander 33 e JP Morgan 33 (banco C/G/D/C respectivamente) são
exemplos desse padrão que já têm dado próprio nas abas de histórico hoje.

**"Rede Dor 30 2" é diferente**: é o mesmo bond que "Rede Dor 30" (confirmado pelo Daniel), mas
**não tem bloco próprio** nem em "Bid Yield" nem em "Preços". Resolvido via
`HISTORY_NAME_ALIASES` (`api/bonds.js`) / `$BONDS_HISTORY_ALIASES` (`server.ps1`) — um mapa
curado manualmente, papel por papel (não é regra automática por ISIN, porque nem toda duplicata
de ISIN é esse caso — ver parágrafo acima), que troca o nome pedido pelo nome do papel-fonte antes
de procurar o bloco de histórico. Hoje só tem `'Rede Dor 30 2' → 'Rede Dor 30'`; se aparecer
outro caso igual, é só adicionar uma linha nos dois arquivos.

### 16.2.4 Seções geográficas + ordenação por duration

A própria planilha já organiza "Controle Duration" com **linhas divisórias** (nome na coluna D,
ISIN vazio): Brasil, Europa, US Consolidado, Preferred, África/Ásia/Latam, Fundos de Bonds.
Detectadas por uma **lista fixa de 6 rótulos exatos** (`BONDS_SECTIONS` em `api/bonds.js`,
`Test-BondsSectionDivider` em `server.ps1`) — não por "tem nome sem ISIN" genérico, porque
alguns papéis de verdade também não têm ISIN preenchido (ex: "CLN Volkswagen") e não devem virar
seção por engano. Cada papel do snapshot carrega o `section` do último divisor visto antes dele.

**"África/Ásia/Latam" tem acento** — no `server.ps1`, comparar contra esse literal diretamente
teria o mesmo risco de corrupção já documentado pra "Mês Anterior" (seção 3: Windows PowerShell
5.1 lê `.ps1` sem BOM no codepage do sistema, não UTF-8). Resolvido casando só pelo sufixo
seguro `-like '*Latam'` em vez do texto inteiro — mesma técnica já usada em
`Get-XlsxSheetMap` pra resolver o nome da aba "Preços" (`ç`) por padrão (`'Pre*'`) em vez de
igualdade exata.

**Ordenação**: dentro de cada seção, os papéis vêm ordenados por **duration crescente**
(front-end, `sortBondsWithinSections()` em `index.html` — a ordem de seções em si segue a ordem
de aparição na planilha). **Exceto "Fundos de Bonds"**, que fica na ordem original da planilha
sem reordenar — a pedido explícito do Daniel.

### 16.2.5 Tabela e modal de histórico

Tabela reaproveita as classes `.close-table`/`.close-row`/`.close-region` já usadas no relatório
de Fechamento (seção 6.8) — região aparece como cabeçalho em destaque azul entre grupos.
Clique numa linha abre um modal (mesmo padrão do histórico de NTN-B/DI Futuro, seção 8) com:

- **Alternador YIELD/PREÇO** — troca a série mostrada. **Escondido pra papéis de "Fundos de
  Bonds"**: fundos nunca vão ter preço (a pedido do Daniel — funds não são cotados por preço
  igual bond individual), então o botão simplesmente não aparece pra eles em vez de oferecer um
  modo que nunca carrega nada (`openBondHistory()` verifica `bond.section` e escode o botão via
  `style.display`).
- **Combo "comparar com treasury"** (3M/6M/1Y/2Y/3Y/5Y/7Y/10Y) — só habilitado no modo Yield
  (preço vs. yield de treasury não são comparáveis, unidades diferentes). Sobrepõe uma segunda
  linha pontilhada cinza no mesmo gráfico, mesmas datas.
- **Spread calculado e mostrado no cabeçalho** quando um treasury está selecionado: yield do
  papel − yield do treasury, no último dia em que os dois têm dado (não necessariamente o último
  ponto da série do papel — as duas fontes podem atualizar em dias diferentes).
- Seletor de período **1M/3M/6M/1A/2A** (sem "DESDE O INÍCIO" — removido a pedido do Daniel).
- Labels do eixo X com **dia/mês/ano** (`DD/MM/AA`), não só dia/mês como os outros gráficos do
  terminal — pedido explícito, porque o histórico cobre ~5 anos e dia/mês sozinho fica ambíguo.

### 16.2.6 Filtros por Duration, Cupom e Spread

Três grupos de filtro (faixa mín/máx) acima da tabela — Duration, Cupom (%), Spread (p.p.) — com
link "limpar filtros". Os `<input>` ficam **fora** de `#bonds-body` de propósito: esse `<div>` é
reconstruído inteiro a cada render (`renderBondsTable()`), então inputs *dentro* dele perderiam
foco/valor a cada filtro aplicado. O contador no topo mostra "X de Y papéis" quando algum filtro
reduz a lista, ou só "Y papéis" quando não há filtro ativo.

### 16.2.7 Papéis sem preço e/ou yield (pendência viva)

Lista de referência gerada por análise (não lida por nenhum código) em
`Bonds Terminal/papeis_sem_precos.txt`. Estado em 19/08/2026, depois de o Daniel completar dado
pra XP 29/XP 29 2/Santander 33/JP Morgan 33: sobram **16 de 69** sem preço e sem yield — os
**15 Fundos de Bonds** (esperado, não vamos ter mesmo — ver 16.2.5) e **"TBILL 12-nov-26"**
(seção "US Consolidado", não é fundo — único caso real ainda sem tratamento, sem alias
disponível porque não é duplicata de nenhum outro papel da lista).

### 16.2.8 Bugs reais corrigidos nessa sessão

Cinco bugs reais, encontrados construindo e testando essa aba — os 3 primeiros valem como lição
geral pra qualquer parser de XML/planilha escrito à mão em PowerShell daqui pra frente, não só
pra bonds:

1. **Regex numa passada só sobre XML grande perde células silenciosamente.** Rodar o regex de
   célula (`<c r="...">...</c>`) direto sobre a string XML inteira de uma aba grande (~5MB,
   "Bid Yield" tem ~300 mil células) fazia alguns matches desaparecerem sem erro nenhum —
   confirmado ao vivo (célula A10 saía do mapa mesmo com XML idêntico a outras que funcionavam).
   O mesmo padrão, testado isolado num trecho pequeno, casava certo — o problema só aparece em
   documentos muito grandes. **Corrigido em duas passadas**: separa por `<row>...</row>` primeiro
   (bem menor cada), casa células dentro de cada linha depois (`ConvertTo-XlsxCellMap`).
2. **Tags autofechadas (`<c r="C1" s="138"/>`) vazam pra célula vizinha.** Excel escreve células
   vazias-mas-estilizadas (só formatação, sem valor) como tag autofechada, sem `</c>`. Um regex
   que só reconhece a forma aberta+conteúdo+fechamento tenta casar a autofechada como se fosse
   aberta, e o `(.*?)` não-greedy "vaza" através dela (e de outras autofechadas em sequência) até
   achar o primeiro `</c>` de verdade — atribuindo o valor de uma célula à frente pra célula
   errada (confirmado: "C1" recebia o valor real de "E1"). **Corrigido com alternância** no
   regex: casa a forma autofechada primeiro (ignora, sem valor) OU a forma aberta normalmente.
3. **`[int]` em PowerShell arredonda, não trunca.** `ConvertTo-ColLetter` (número de coluna →
   letra) fazia `$N = [int](($N-1)/26)` a cada iteração, assumindo truncamento — mas `[int]`
   aplicado a um `double` em PowerShell **arredonda pro inteiro mais próximo**
   (`[int]4.538` = 5, não 4), diferente de `Math.floor()` (JS) ou `int()` (Python). Corrompia a
   letra calculada pra qualquer coluna cuja divisão intermediária caísse em fração ≥ 0,5 —
   silenciosamente, sem erro. Só não apareceu nos primeiros testes porque os papéis testados
   ficavam em colunas baixas o suficiente pra nunca bater nesse caso ("JP Morgan 33", adicionado
   depois numa coluna mais à direita, expôs o bug). **Corrigido com `[math]::Floor()`**
   explícito. Só afetava o `server.ps1` (dev local) — `api/bonds.js` (produção) já usava
   `Math.floor()` corretamente desde o início.
4. **`xlsx` (Node) decide Date vs. número pelo FORMATO da célula, não pelo valor.** Com
   `cellDates: true`, a lib olha o **estilo de número aplicado à célula** pra decidir se converte
   pra `Date`. O bloco de preço de "JP Morgan 33" em "Preços" tinha formatação de data aplicada
   por engano numa coluna de preço normal (confirmado no Excel pelo Daniel: exibia "102,0762", um
   preço, não uma data) — a lib lia isso como um objeto `Date` bizarro de 1900 em vez do número,
   e a série toda parecia vazia. **Só afetava produção** (`api/bonds.js`, via `xlsx`) — o
   `server.ps1` nunca teve esse problema, porque o parser manual de XML nunca olha formatação,
   só o valor bruto. **Corrigido removendo `cellDates: true`** — toda célula numérica volta como
   número puro, independente do formato exibido — e convertendo a coluna de Timestamp
   manualmente a partir do serial do Excel (`excelSerialToBr()`).
5. **Mesma classe do bug de "Mês Anterior" (seção 3), duas vezes novas**: nome de aba "Preços"
   (`ç`) e rótulo de seção "África/Ásia/Latam" (`Á`) — literais acentuados no próprio `.ps1` não
   dão pra comparar diretamente contra texto extraído do `.xlsx` (esse sim lido como UTF-8 de
   verdade). Resolvido casando por padrão ASCII-safe (`'Pre*'`, `-like '*Latam'`) em vez de
   igualdade exata — ver 16.2.1 e 16.2.4.

**Lição geral pra manutenção futura**: ao escrever ou estender um parser manual de `.xlsx` em
PowerShell, (a) nunca rodar regex de célula sobre o XML da aba inteira de uma vez em planilhas
grandes — separar por linha primeiro; (b) sempre tratar tags autofechadas de `<c>` como um caso
explícito, nunca assumir que toda célula tem conteúdo entre tags; (c) nunca usar `[int]` pra
truncar um `double` — usar `[math]::Floor()`. E ao ler `.xlsx` no Node via `xlsx`, ter em mente
que `cellDates: true` confia na formatação da célula, não no valor — se uma coluna deveria ser
sempre numérica independente de como a célula foi formatada, ler sem `cellDates` e converter só
as colunas que você sabe que são data, manualmente.

---

## 16.1 [REMOVIDO] Aba ELEIÇÕES — Polymarket (metodologia preservada)

**Removida a pedido do usuário (26/10/2026)**: botão de navegação, painel `#tab-elections`, bloco JS
`// ── Eleições · Polymarket`, variável `electionsLoaded` + linha em `switchTab`, e a seção "Eleições" do
modal de Fontes. Era "Presidencial Brasil 2026" — gráfico de probabilidade implícita por candidato. **Esta seção
guarda a receita pra recriar sem reinvestigar a API. Não recriar sem pedido explícito.**

**Sem proxy, sem função serverless**: as APIs públicas da Polymarket respondem com
`Access-Control-Allow-Origin: *` (confirmado ao vivo), então o navegador chamava direto — não gastava nenhum dos
12 slots de função do Vercel Hobby.

**Endpoints**
1. **Candidatos + preço atual** — `GET https://gamma-api.polymarket.com/events?slug=brazil-presidential-election`
   → array; usar `[0].markets`. Filtrar `active && !closed && outcomePrices && clobTokenIds`.
   - **Pegadinha**: `outcomePrices` e `clobTokenIds` vêm como **string contendo JSON** — precisa de `JSON.parse`
     extra. `outcomePrices[0]` = preço do "Yes" (0–1, ×100 = % de chance); `clobTokenIds[0]` = token do "Yes".
   - Nome do candidato: `m.groupItemTitle || m.question`.
   - Evento tinha ~19 candidatos ativos, a maioria perto de 0% → ordenar por preço desc e manter só os **6** maiores.
2. **Histórico** — `GET https://clob.polymarket.com/prices-history?market=<tokenId>&interval=max&fidelity=1440`
   → `{history:[{t (segundos Unix), p (0–1)}]}`. `fidelity=1440` = 1 ponto/dia. Buscado 1× por token (cache em
   `Map`), nunca refiltrado por range.

**Decisões de UI (a pedido do usuário)**
- **Sem seletor de horizonte** ("não faz sentido" pra mercado com data de resolução fixa): sempre história completa.
- Card por candidato: bolinha de cor, nome, `Yes XX,X¢`, probabilidade em %, e Δ em **p.p. vs 30 dias atrás**.
- Aviso permanente: preço = probabilidade implícita dos traders (60¢ = 60%), **não é pesquisa eleitoral**.

**Bugs reais do gráfico (Chart.js linha) e correções**
- Snapshots de candidatos diferentes **não têm os mesmos horários**, e podia haver 2 por dia no mesmo candidato →
  tooltip duplicava candidatos. **Correção**: chavear o histórico por **dia inteiro** (`Math.floor(t/86400)`,
  ficando com o último do dia) e usar **uma grade de dias única** (união de todos os dias de todos os candidatos)
  em todos os datasets; com isso `interaction.mode: 'index'` é seguro. (`mode: 'x'` casa 2 pontos do mesmo
  candidato quando o dado é mais denso que os pixels.)
- **Carregar pra frente** o último preço conhecido nos dias sem snapshot (preço sem negociação nova = último preço
  negociado); antes do 1º preço conhecido fica `null` (buraco real). `spanGaps: 20`.
- Eixo X linear em dia-índice, reaproveitando `ntnbDayIdxToLabel` (mesmo do gráfico da NTN-B — **essa função
  continua em uso pela NTN-B, não apagar**). Eixo Y fixo 0–100%. Plugin `dragRange` ativo (com `events` incluindo
  `mousedown`/`mouseup`, ver seção 8.3). 6 cores fixas pros candidatos.

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
suficiente pra não precisar de modal dedicado. **A aba BONDS (seção 16.2) segue o mesmo padrão**
— nota fixa própria abaixo da tabela, sem entrada em `#sources-overlay`.

---

## 18. Otimização de Custo do Vercel

> **O projeto está no PRO desde 18/11/2026** (ver seção 0). Tudo abaixo foi feito sob a cota do
> Hobby e **continua valendo** — as otimizações seguem boas — mas **deixaram de ser restrição**.
> No Pro há US$ 20 de crédito contra um consumo medido de ~US$ 1,21/mês, e o teto de 12 funções
> acabou. Antes de recusar algo "por custo", confira se a premissa ainda vale.

Plano **Hobby** (histórico): 1M invocações/mês **e 4 horas de "Fluid Active CPU" por janela de
30 dias**. Auto-refresh (60s) só dispara enquanto uma aba está aberta e em foco
(`visibilitychange` pausa o timer em segundo plano). **NOTÍCIAS não entra no ciclo de 60s** —
carrega ao abrir a aba e tem seu próprio ciclo de notificação (seção 15.1.7).

### 18.0 Incidente real: cota de CPU estourada (10/11/2026) — e as otimizações que entraram
**O que aconteceu**: e-mail do Vercel avisando que o time grátis tinha usado **103% das 4h de
Fluid Active CPU**, com a conta a ser **pausada em 24h**. 99,3% do consumo era do
`terminal-financeiro`.

**Diagnóstico** (as duas causas somadas):
1. **Uma invocação por ticker.** Cada ciclo de 60s pedia ~26 tickers ao Yahoo em ~26 requisições
   separadas. Cada invocação de função paga o próprio overhead fixo de CPU (boot do módulo,
   parse/serialize) — esse overhead, multiplicado por 26 × 60 ciclos/hora, era o grosso da conta.
2. **`/api/ai-news` sem cache nenhum.** É de longe a função mais cara do projeto (12 fontes ×
   várias páginas + raspagem das homepages + clustering TF-IDF ≈ 3s de trabalho real por
   chamada), e o ciclo de notificação a chamava **a cada 120s** o tempo todo que o terminal
   estivesse aberto, em qualquer aba. Todos os endpoints estavam com `Cache-Control: no-store`.

#### 18.0.0 Como a cota do Hobby realmente funciona (pesquisado na fonte, 10/11/2026)
**Não existe data de reset.** A doc oficial do plano Hobby diz, literalmente, que *"as the Hobby
plan is a free tier there are no billing cycles"* e que, ao estourar, *"you will have to wait
until 30 days have passed before you can use the feature again"*. Um mantenedor da Vercel
descreveu como **janela móvel de 30 dias** ("rolling 30 day period, so it's always looking at
the past 30 days"). A interface confirma: só oferece janelas móveis (7/14/30 dias, 3/12 meses),
sem a opção "ciclo de cobrança atual" que contas pagas têm.

> **Consequência prática que muda tudo**: o uso **não zera num dia** — ele cai aos poucos,
> conforme cada dia pesado completa 30 dias e sai da janela. E, se o consumo diário continuar no
> mesmo patamar que estourou a cota, a janela **nunca** volta pra baixo do limite. Reduzir o
> consumo não é opcional: é o que torna a recuperação possível.

**O despause NÃO é automático.** A KB da Vercel diz que projetos pausados voltam *"one at a
time, never automatically"*. Relatos recorrentes na comunidade confirmam: mesmo com o uso já
dentro do limite, a conta segue pausada até você **pedir o despause em vercel.com/help**.

**Atenção — `vercel-usage.ps1` está errado**: ele soma "do dia 1 do mês atual até agora", o que
**não corresponde** à janela móvel de 30 dias que a Vercel usa de fato. Os números dele não batem
com o painel. Se for usado pra monitorar a cota, precisa ser reescrito pra janela móvel.

**Outros tetos do Hobby** (não só o de CPU): Provisioned Memory 360 GB-hrs, Invocations 1M, Fast
Data Transfer 100 GB, Fast Origin Transfer 10 GB, CDN Requests 1M. Diferença importante:
**Active CPU só conta enquanto o código roda** (pausa durante I/O — esperar o Yahoo responder não
conta), enquanto **Provisioned Memory conta a vida inteira da instância, I/O incluído**. Pro
perfil deste projeto (proxies I/O-bound), a medição de 10/11/2026 foi CPU 4h11m/4h (**105%**, o
gargalo) contra memória 50,5/360 GB-hrs (14%) e invocações 226K/1M (23%) — ou seja, só a CPU
apertava.

**O que foi implementado:**

| # | Mudança | Onde |
|---|---|---|
| 1 | **Lote de cotações**: `/api/yahoo?t=A,B,C` resolve vários tickers numa invocação só. ~26 invocações/ciclo → **1**. | `api/yahoo.js`, `index.html`, `server.ps1` |
| 2 | **Cache de CDN** (`s-maxage`) em todos os endpoints, no lugar de `no-store` — requisição repetida dentro da janela é servida pela CDN **sem invocar a função**. | todos os `api/*.js` |
| 3 | **Cache em memória** no `ai-news` (5 min), 2ª camada pra quando a CDN expira mas a lambda está quente. | `api/ai-news.js` |
| 4 | **Ciclo de notificação 120s → 300s**, alinhado ao cache de 5 min do backend. | `index.html` |
| 5 | **Pausa por inatividade (15 min)** — ver 18.0.2. | `index.html` |

#### 18.0.1 Lote de cotações — como funciona
`/api/yahoo` aceita `t` com **um** ticker (resposta = JSON cru do Yahoo, **formato original
preservado**, que os gráficos/histórico/intraday já esperam) ou **vários separados por vírgula**
(resposta = `{ batch: { "<ticker>": <JSON cru> } }`).

No front-end **as funções que chamam `yahoo(ticker)` não mudaram**. O agrupamento é interno:
`yahooChart()` põe o pedido numa fila (`yahooQueue`) e um `setTimeout` de 20ms
(`YAHOO_BATCH_WINDOW_MS`) dispara o `flushYahooBatch()`, que manda tudo que caiu na janela num
pedido só. Como `loadAll()` dispara todos os `load*()` no mesmo tick, os ~26 tickers caem
naturalmente no mesmo lote. **Ao adicionar um card novo que chame `yahoo()`, não é preciso fazer
nada** — ele entra no lote sozinho.

Detalhes que importam:
- **Concorrência limitada a 8** (`MAX_CONCURRENT` em `api/yahoo.js`): 26 requisições simultâneas
  ao Yahoo saindo do mesmo IP tendem a levar 429. Em ondas de 8 o lote sai em ~1-2s.
- **Cookie+crumb compartilhados** (`cachedAuth`, TTL 10 min): o fallback de fechamento anterior
  (seção 6.6.1) custa 2 requisições de autenticação; sem compartilhar, um lote com 3 commodities
  pagaria 6. Espelhado em `Get-YahooAuth` no `server.ps1`.
- **Contrapartida honesta**: um ticker lento agora atrasa o lote inteiro, e se o pedido falhar de
  vez, todos caem juntos (cada um ainda cai no seu cache de `localStorage`, então degrada bem).
  Com 8 em paralelo isso não apareceu nos testes.

#### 18.0.2 Pausa por inatividade
O terminal atualizava a cada 60s o dia inteiro mesmo largado aberto num monitor de lado —
`visibilitychange` só cobre aba minimizada/em segundo plano, não "janela visível e ninguém
olhando". Agora, **15 min** (`IDLE_PAUSE_MINUTES`) sem `pointerdown`/`keydown`/`wheel`/
`touchstart`/`focus` → `pauseCycles()` para o ciclo de 60s **e** o de notificação, e o contador
no rodapé mostra **"pausado"**. Qualquer interação chama `resumeCycles()`, que dispara um
`loadAll()` **imediato** — então, na prática, quando você volta a olhar o dado já está fresco.

#### 18.0.3 Tabela de cache por endpoint
| Endpoint | `s-maxage` | Por quê |
|---|---|---|
| `ai-news` | 300s | função mais cara do projeto; + cache em memória de 5 min |
| `yahoo` | 30s | abaixo do ciclo de 60s — não atrasa nada, dedupe entre abas/pessoas |
| `b3`, `treasury` | 45s | DI Futuro já vem com ~15min de atraso da origem |
| `anbima`, `ntnb`, `rates` | 900s | dado de fechamento **diário**, não muda durante o pregão |
| `news` | 600s | resumo de IA do mesmo artigo é sempre o mesmo (poupa cota do Gemini) |
| `target`, `quote-search` | 3600s | price target muda em semanas; resolver texto→ticker é estático |

**Regra pra endpoint novo**: `no-store` só se o dado mudar a cada segundo *e* não puder atrasar.
Em qualquer outro caso, escolher um `s-maxage` ≤ à frequência real de mudança da fonte.

#### 18.0.4 Lição de performance do `server.ps1` (só dev local)
Ao espelhar o lote, a primeira versão fazia `ConvertFrom-Json` em cada ticker e
`ConvertTo-Json -Depth 15` no conjunto: o lote de 26 levava **~25s**. O gargalo era o
`ConvertTo-Json` do PS 5.1 sobre ~370KB. A versão atual (`Get-YahooChartRaw`/`Get-YahooChartBatch`)
**trabalha com o JSON cru como string**, só procurando o campo do fechamento anterior por regex e
injetando o valor no texto quando falta — **lote caiu pra ~4,4s**. Também foi preciso subir
`[System.Net.ServicePointManager]::DefaultConnectionLimit` (padrão .NET = **2 conexões por
host**, o que serializava tudo).

> **Atenção ao medir o servidor local**: o `HttpListener` do `server.ps1` é **mono-thread** —
> atende uma requisição por vez. Se o navegador estiver com o terminal aberto, qualquer medição
> por `curl`/`Invoke-WebRequest` entra na fila atrás dele e dá número inflado (chegamos a medir
> 27s pro que na verdade levava 1,8s). Pra medir, suba uma instância própria noutra porta
> (`$env:PORT`) **sem** nenhuma aba aberta nela. No Vercel isso não existe: cada endpoint é uma
> lambda paralela.

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
`module.exports` num arquivo novo. Também declara as dependências `ws` (cliente WebSocket, usado
pelo histórico de DI Futuro) e `xlsx` (lê "Taxas Antigas NTNB.xlsx" e "Bonds Terminal.xlsx",
seções 6.8.1 e 16.2) — precisam estar de fato no repositório pro build funcionar.

### 19.1.1 Limite de funções serverless — HISTÓRICO, não vale mais
> **No Pro não há teto** (doc da Vercel: "Hobby: 12, Pro e Enterprise: No limit"). Hoje são
> **14 arquivos** em `api/` e isso está OK. O texto abaixo é o histórico, porque explica por
> que vários endpoints são multi-rota em vez de arquivos separados.

O Vercel **Hobby** limitava a **12 Serverless Functions por deployment** (1 função = 1 arquivo
em `api/*.js`). Batemos nesse limite — resolvido fundindo pares de endpoints da mesma fonte de
dados numa função só cada (`b3.js`+`di-history.js`, `ntnb.js`+`ntnb-history.js`,
`news.js`+`summarize-news.js`). **Essas fusões ficam como estão**: funcionam, e desfazer seria
mexer em código testado sem ganho.

**Lição real**: apagar um arquivo localmente **não remove ele do repositório remoto** se o
próximo upload não incluir a remoção explicitamente — já virou órfão contando pro limite antes.
Sempre que remover uma aba/feature que tinha arquivo(s) próprio(s) em `api/`, **lembrar de
deletar esses arquivos no GitHub também**. Ao criar uma função nova, considerar primeiro se ela
pode virar uma rota dentro de um arquivo já existente da mesma fonte de dados.

### 19.1.2 `vercel.json` → `functions.api/ntnb.js` e `functions.api/bonds.js`
Duas configs adicionadas pro modo `?staticAnchors=1` do `api/ntnb.js` (seção 6.8.1), e as mesmas
duas pro `api/bonds.js` (seção 16.2):
- `"maxDuration": 15` — ler e parsear o `.xlsx` é rápido, mas deixa uma margem sobre o timeout
  default do Hobby.
- `"includeFiles"` — **obrigatório**. Sem isso o Vercel pode não incluir esse arquivo no bundle
  da função (ele não é código, é um dado estático fora de `api/`), e o modo que depende dele
  funcionaria local mas quebraria em produção com "arquivo não encontrado". Se a planilha for
  renomeada ou movida, esse campo precisa acompanhar.

**Incidente real (BONDS)**: o código do `api/bonds.js` foi corrigido numa sessão pra ler
`Bonds Terminal.xlsx` da raiz do repo, mas o `vercel.json` não foi atualizado no mesmo upload —
continuou apontando `includeFiles` pro caminho antigo (`Bonds Terminal/Bonds Terminal.xlsx`,
subpasta). Resultado: `ENOENT` em produção mesmo com o `.xlsx` certo já presente na raiz do
GitHub, porque o Vercel simplesmente não empacotava esse arquivo na função (o `includeFiles`
errado não "encontra por perto" — se o caminho não bate exatamente, o arquivo não entra no bundle
nem existe pro `/var/task/...` da função em runtime). **Lição**: `api/*.js` e `vercel.json` são
dois arquivos que descrevem a mesma dependência de arquivo estático de dois jeitos diferentes —
mudar o caminho num sem mudar no outro quebra em produção mesmo que localmente (`server.ps1`)
funcione, porque o `server.ps1` lê o arquivo direto do disco, sem depender de `includeFiles`
nenhum.

### 19.2 Fluxo do Daniel (não é git CLI)
Sobe arquivos manualmente pela interface web do GitHub ("Add files via upload"), que dispara
redeploy automático no Vercel. **Sempre listar exatamente quais arquivos mudaram** ao final de
cada tarefa, e avisar explicitamente quando um arquivo precisa ser **deletado** no repositório
(não só criado/atualizado). A pasta `chrome-extension/` **nunca** vai pro GitHub/Vercel.

### 19.3 Variáveis de ambiente necessárias no Vercel
| Variável | Usada por | Situação |
|---|---|---|
| `GEMINI_API_KEY` | `api/news.js` (`?action=summarize`) | **configurada** — botão "resumir com IA" |
| `GITHUB_TOKEN` | `api/cron-ntnb.js` | **configurada** em 18/11/2026 (Production/Preview/Development) |
| `CRON_SECRET` | `api/cron-ntnb.js` | **FALTA CRIAR** — sem ela o cron responde 401 a tudo (seção 26) |

`BONDS_API_KEY` não é mais usada — pode ser removida do Vercel (Settings → Environment
Variables).

**Sobre o `CRON_SECRET`**: a Vercel manda o valor como `Authorization: Bearer` nas chamadas
agendadas. Só letras e números, 16+ caracteres — a doc avisa que vai como cabeçalho HTTP, e um
espaço ou quebra de linha colado junto faz toda invocação virar 401. **E é obrigatório
redeployar depois de salvar**: o deploy captura a variável no momento em que é construído, então
editar sem redeployar não muda nada.

**O `GITHUB_TOKEN` é o mesmo** que está em `Sync Bonds GitHub/config.json` (fine-grained,
permissão Contents: Read and write, só no repo `Terminal---Ondina`). Ele **venceu em 18/11** e
foi renovado — e vale a lição: *"renovar" um token no GitHub gera um valor NOVO e invalida o
antigo na hora*. O painel mostra o token como ativo com validade nova, mas o valor guardado no
arquivo já morreu. Depois de renovar, tem que colar o valor novo nos dois lugares.

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
Sans + mono, via Google Fonts — a fonte mono trocou de IBM Plex Mono pra JetBrains Mono junto
com o `index.html`, seção 0), abas e sub-abas em pílula (fundo navy quando ativa) em vez do
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
  Ouro e câmbio negociam bem depois do fechamento das bolsas de ação (seção 6.8). Pra saber se a
  última barra é definitiva, checar `meta.currentTradingPeriod.regular` (mesmo campo da seção 7)
  e descartar a barra enquanto a sessão daquele ativo especificamente ainda está aberta — não uma
  hora de corte fixa pra todos.
- **Script de terceiro no `<head>` sem `defer`/`async` bloqueia a renderização da página
  inteira**, não só a feature que usa esse script — o Chart.js carregava assim (só é usado quando
  alguém abre um gráfico, mas travava o parse do HTML e a execução do `<script>` principal até
  baixar da CDN). Corrigido com `defer`; qualquer chamada de topo de página que dependa da lib
  (ex: `Chart.register(...)`) precisa mover pra dentro de um listener de `DOMContentLoaded`
  (scripts `defer` rodam antes desse evento, então nessa altura já está garantido que existem).
- **Chamadas de rede independentes dentro do mesmo loader não devem ser `await`-adas em
  sequência** — `loadBrasil()` (CDI → Selic → IBOV) e `loadJuros()` (Fed → BCE → T-Note) faziam 3
  requisições em série sem nenhuma depender da anterior, o que soma os tempos de resposta em vez
  de pegar só o da mais lenta. Corrigido envolvendo cada bloco `try/catch` num IIFE assíncrono e
  rodando os três via `Promise.allSettled`. Ao adicionar um loader novo com mais de uma chamada
  independente, usar esse padrão desde o início.
- **Cache do relatório de Fechamento em `localStorage` precisa de versão no nome da chave**
  (`CLOSE_REPORT_CACHE_KEY`, hoje `'close_report_v4'`) — a chave antiga só mudava quando a data de
  referência mudava, então quem já tinha o relatório em cache continuava vendo a config antiga
  (instrumento removido/adicionado) até o dia virar sozinho. **Bump o `v2`→`v3` etc. sempre que
  `CLOSE_REPORT_CONFIG` mudar de forma relevante** (instrumento novo, campo novo no payload) —
  isso invalida o cache de todo mundo automaticamente, sem exigir nenhuma ação manual do usuário.
- **Parser manual de `.xlsx` em PowerShell (zip + regex de XML, sem lib) tem três armadilhas
  reais** (encontradas construindo a aba BONDS, seção 16.2.8, detalhe completo lá):
  (1) rodar o regex de célula sobre a string XML **inteira** de uma aba grande perde matches
  silenciosamente — separar por `<row>...</row>` primeiro; (2) células autofechadas
  (`<c r="X" s="N"/>`, comuns em colunas só-formatação) "vazam" pro conteúdo da célula seguinte
  num regex que só reconhece a forma aberta+fechamento — casar a forma autofechada
  explicitamente antes; (3) `[int]` aplicado a um `double` **arredonda**, não trunca — nunca usar
  pra dividir/truncar índice de coluna ou algo parecido, usar `[math]::Floor()`.
- **Ao ler `.xlsx` no Node via `xlsx` com `cellDates: true`, a lib decide Date-vs-número pela
  FORMATAÇÃO da célula, não pelo valor** — uma célula numérica com estilo de data aplicado por
  engano vira um objeto `Date` sem sentido em vez do número (bug real, seção 16.2.8). Se uma
  coluna deveria ser sempre numérica independente de como alguém formatou a célula na planilha,
  ler sem `cellDates` e converter manualmente só as colunas que você sabe que são data.
- **Trocar a fonte mono (ou qualquer fonte) por nome literal**: procurar TODAS as ocorrências do
  nome antigo no arquivo, não só a variável CSS — `font: { family: '...' }` do Chart.js e
  qualquer `ctx.font = "...px 'Nome'"` de `<canvas>` (seção 6.8.2) citam o nome direto, sem
  passar pela variável `--mono`/`--sans`.

---

## 23. Ficha da Empresa (`/api/company`)

Página de detalhe de um ativo, inspirada na página de ação da **Perplexity Finance**, que o
Daniel apontou como referência. Entrou em 19/11/2026.

**Como se chega**: clicar num resultado da busca rápida (seção 24) abre a ficha — **não** o
gráfico. Os cards do terminal continuam abrindo o gráfico direto, como sempre. Dentro da ficha
há botões "Ver gráfico" e "Notícias".

### 23.1 De onde vêm os dados
Uma única chamada ao `quoteSummary` do Yahoo com **10 módulos de uma vez** (`price`,
`summaryDetail`, `defaultKeyStatistics`, `financialData`, `assetProfile`, `earningsHistory`,
`calendarEvents`, `recommendationTrend`, `majorHoldersBreakdown`, `institutionOwnership`).
Autenticação por cookie+crumb, igual a `api/target.js`, com o par em cache por 10 min.

**A resposta crua passa de 190 KB** — o endpoint reduz ao que a tela usa (**3,3 KB** no NVDA).
Mandar o resto pro navegador seria desperdício.

Cache de CDN de 15 min: fundamentos mudam em trimestres, não em segundos.

### 23.2 O que a ficha mostra
Preço e variação, 17 indicadores (P/L 12m e projetado, LPA, capitalização, dividend yield, beta,
faixa de 52 semanas, abertura, mín/máx do dia, volume, receita, margem, crescimento, caixa,
dívida), régua visual do alvo dos analistas com o preço atual marcado, distribuição das
recomendações em barra, histórico de LPA estimado × real com a surpresa, detentores e perfil.

### 23.3 Nem todo ativo tem tudo
Um ETF não tem P/L nem setor; um índice tem só preço e faixa. **Cada seção some quando não há
dado**, em vez de mostrar campo vazio. Verificado com NVDA (completo), PETR4.SA (B3, em BRL),
GLD (ETF, parcial) e ^GSPC (índice, mínimo).

### 23.4 "De quando são os dados" — por que existe essa linha
A ficha mistura informações de idades **bem diferentes**: o preço é do momento da captura, mas
os múltiplos e o balanço vêm do último trimestre FECHADO, que pode ter semanas. Mostrar junto
sem avisar dá a impressão de que tudo é de agora. Por isso o endpoint devolve `capturadoEm`,
`trimestreRef` e `exercicioRef`, e a ficha exibe:

> preço de 19/11/2026 16:27 · fundamentos do trimestre encerrado em 31/08/26

### 23.5 Notícias da empresa — filtro por citação
`/api/news?t=TICKER&n=Nome` mudou bastante nessa sessão. Antes perguntava ao Yahoo só pelo
ticker e **aceitava tudo que voltasse** — numa busca por NKE vinham notícias de McDonald's.

Duas descobertas que moldaram a solução:

1. **A busca do Yahoo é sensível ao formato.** Testado ao vivo: `PETR4.SA` e `PETR4` devolvem
   **ZERO** notícias, e o nome formal "Petróleo Brasileiro" também — mas **"Petrobras" devolve
   20**. Por isso a consulta manda o ticker E **cada palavra significativa do nome
   separadamente**, nunca o nome formal inteiro.
2. **O Yahoo já marca cada matéria com `relatedTickers`** — a lista de empresas citadas,
   inclusive quando o nome não aparece no título. É o que permite saber que "Dow drops 800
   points" fala da Nvidia **sem baixar e varrer o texto do artigo**.

Uma matéria entra se o `relatedTickers` inclui o ticker **ou** se o título cita nome/ticker.
Palavras vazias demais pra filtrar (Inc, Corp, Group, Holdings…) ficam fora dos termos. Se o
filtro zerar tudo, devolve o que veio em vez de lista vazia.

Medido: NVDA 3 → **18**, Nike 16 → **20**, Petrobras **0 → 9**, Tesla 19.

> **Limite conhecido**: ações da B3 vêm marcadas pelo **ADR** (`PBR`, `PBR-A`), não por
> `PETR4.SA` — nenhuma das 9 da Petrobras casa por ticker, todas passam pelo filtro de título.
> Os dois critérios se complementam de propósito.
>
> E isto **não é** varredura literal do texto: é a marcação do Yahoo. Se um dia for preciso ler
> o artigo inteiro, o extrator de texto já existe em `api/news.js` (usado no "resumir com IA"),
> ao custo de ~20 requisições HTTP e o parse do HTML por consulta.

---

## 24. Busca Rápida (lupa no cabeçalho / Ctrl+K)

Botão **"Buscar"** com ícone de lupa no cabeçalho. Digitar leva ao gráfico ou à ficha de
qualquer ativo, ou troca de aba.

### 24.1 Duas versões — e por que a primeira estava errada
A primeira versão tinha **Ctrl+K como única porta de entrada**. O Daniel reportou três
problemas, todos legítimos:

1. **Não funcionava no iPhone** — não existe Ctrl+K num celular, então a busca era simplesmente
   inacessível. Foi a falha mais séria: um atalho de teclado como único caminho.
2. **Escolher exigia teclado** (setas + Enter).
3. **Só encontrava o que já estava no terminal.**

Correções: o botão visível virou a porta principal (Ctrl+K ficou como atalho de desktop); um
**toque** no resultado abre, com itens de **44px** de altura (alvo de toque do iOS); e o realce
por `hover` só é ligado em quem tem mouse — no toque ele fica "grudado" no último item tocado.

### 24.2 O catálogo se monta sozinho
O índice é construído **a partir do próprio DOM** a cada abertura, lendo os `onclick` que já
existem nos cards (`openChart`, `openNtnbHistory`, `.tab-btn`). **Ativo novo no HTML entra na
busca sozinho** — não há segunda lista pra manter sincronizada. Hoje indexa 49 itens.

### 24.3 Busca no Yahoo
O que não está no terminal vem de `/api/quote-search` — o mesmo endpoint que a busca de ativos
em SINGLE NAMES já usava. Então Tesla, `PETR4.SA`, qualquer ticker aparece.

Detalhes que importam: **300ms de atraso** pra não disparar uma chamada por tecla; um número de
sequência descarta resposta que chegue fora de ordem; **timeout de 12s** (nos cards do ciclo
automático 6s está certo, porque lá há cache pra onde cair — numa busca, desistir cedo significa
não achar nada). Resultados remotos entram depois dos locais e sem repetir ticker existente.

---

## 25. Comparação de Ativos no Mesmo Gráfico

Botão **"+ comparar"** no modal do gráfico sobrepõe até **4** ativos.

**Com comparação ativa o gráfico troca de preço para BASE 100** — ouro a 4.000 e um ETF a 80 só
são comparáveis em desempenho relativo. Sem comparação, segue mostrando preço, como sempre.

Séries de bolsas diferentes são alinhadas **por dia calendário**, repetindo o último preço
conhecido nos dias sem negociação e deixando `null` antes do primeiro preço (buraco de verdade,
não inventa dado) — mesma lição da seção 13.2.

Abrir outro ativo **zera** a comparação. "Desde o início" não aceita comparação, por ter lógica
própria de tranches.

> **Pegadinha real**: a paleta do gráfico "Desde o início" tinha só 2 cores, e o ouro passou a
> ter 3 tranches — a terceira linha sairia sem `borderColor`. A paleta precisa ter pelo menos
> tantas cores quanto o ativo com mais datas em `SINGLES_ENTRY_DATES`.

---

## 26. Captura de NTN-B por Cron na Vercel

`api/cron-ntnb.js`, agendado em `vercel.json` para **segunda a sexta às 18:00 UTC** (15:00 de
Brasília, ~3h depois do corte de coleta da ANBIMA).

Substitui a tarefa `SalvarNtnbSemanal` do PC do Daniel, que dependia da máquina ligada (dias
perdidos em viagem) e abria uma janela de console a cada boot.

> ### ESTÁ INERTE ATÉ ALGUÉM CRIAR O `CRON_SECRET`
> O endpoint **grava no repositório**, então exige o `Authorization: Bearer <CRON_SECRET>` que a
> Vercel envia nas chamadas agendadas. Sem a variável nas Environment Variables, ele responde
> **401 a tudo** — inclusive ao próprio cron. É o comportamento seguro, mas significa que o
> histórico está **congelado em 17/11/2026**.
>
> Pior: a tarefa do Windows ainda grava na planilha, que **deixou de ser lida** (seção 26.1).
> Então hoje as capturas vão para um arquivo que ninguém usa. Uma destas precisa acontecer:
> criar o `CRON_SECRET` (e redeployar — a variável só é capturada no build), ou adaptar a tarefa
> local pra gravar o JSON.

**Como grava**: função serverless não tem disco. O dado vai pro próprio repositório pela API do
GitHub (variável `GITHUB_TOKEN`, já configurada), e **o commit dispara o redeploy — que é
justamente o que coloca o dado novo no ar**. Custo: ~20 deploys automáticos por mês na lista.

**Idempotente de propósito**, porque a doc da Vercel avisa que a entrega do cron é "best effort"
e pode disparar a mesma execução mais de uma vez ou nenhuma: a janela de 12 dias úteis é
reprocessada inteira, só os dias **ausentes** são acrescentados, e sem novidade não há commit.
Rodar duas vezes tem o mesmo efeito de rodar uma; um dia pulado é recuperado na corrida seguinte
(12 dias úteis cobrem com folga a retenção de ~9 da ANBIMA).

O `PUT` manda o `sha` do arquivo lido, então alteração feita entre a leitura e a escrita faz a
gravação falhar em vez de sobrescrever.

### 26.1 Bug grave: a planilha de NTN-B inchou pra 1 GB

Descoberto em 19/11/2026. O arquivo em disco estava com **1.006.693.706 bytes (960 MB)**, tendo
**31,5 MB** oito dias antes.

**Causa**: o `XLSX.writeFile` do `salvar-mes.mjs` reescrevia o `xl/theme/theme1.xml` inflado a
cada gravação semanal, multiplicando por ~32. O arquivo de 1 GB era **99,996% tema** — as abas
de dados somavam ~45 KB, com **1.155 células** no total.

**Consequências que isso já causava**, sem ninguém perceber:
- O arquivo **nunca mais conseguiria ser publicado** (GitHub recusa acima de 100 MB) — as
  capturas semanais estavam presas no disco local.
- Inflava o bundle da função `api/ntnb.js` (limite de 250 MB).

**Correção**: o `.xlsx` foi reescrito copiando todas as entradas do zip e trocando **só** o
`theme1.xml` por um tema Office mínimo (1,9 KB). As abas passaram byte a byte. Resultado:
**1 GB → 53 KB**, com as 1.155 células verificadas uma a uma (0 faltando, 0 divergentes).

**A causa raiz some com a migração pro JSON**: `data/ntnb-historico.json` virou a fonte de
verdade (76 snapshots em 12,5 KB), e a planilha ficou como **arquivo histórico congelado**, sem
código escrevendo nela. `api/ntnb.js` prefere o JSON e só cai no `.xlsx` se ele faltar — **sem
comparar data de modificação**, porque num checkout (Vercel, clone novo) todos os arquivos
ganham a mesma data e a comparação não diria nada.

Verificado: `?staticAnchors=1`, `?days=30` e `?days=120` produzem saída byte a byte idêntica
pelos dois caminhos. `staticAnchors` caiu de **242ms para 11ms** de CPU.

---

## 27. Hospedar Fora da Vercel (`server.js`)

Criado em 11/11/2026, quando a conta Hobby foi pausada e foi preciso um plano B. **Não é usado
hoje** (o Pro resolveu), mas fica pronto e testado.

`server.js` serve o `index.html` e monta os **mesmos** `api/*.js` **sem alterar nenhum deles**.
Isso é possível porque os handlers usam a mesma assinatura (`handler(req, res)`) e só quatro
coisas: `req.query`, `res.status`, `res.setHeader` e `res.json`. Um shim de ~15 linhas entrega
essas quatro sobre o `req`/`res` cru do `node:http`. **Sem dependência nova.**

Rodar local: `node server.js .` e abrir `http://localhost:8080`.

**Render**: Build `npm install && node scripts/build-bonds.mjs`, Start `node server.js`. O plano
Free hiberna após 15 min e leva ~1 min pra acordar; são 750 horas/mês por workspace, que cabem
num mês inteiro ligado (720h). O plano de US$ 7 não hiberna.

> **Não ligue um ping pra manter o serviço acordado**: a resposta do lote de cotações tem 374 KB,
> e chamando 24h/dia daria ~16 GB/mês contra uma franquia de banda de ~5 GB no Free.

O `.vercelignore` mantém `server.js` e `scripts/` fora do deploy da Vercel, e o `vercel.json`
tem `"framework": null` e `"buildCommand": ""` — a auto-detecção da Vercel pode mudar de
comportamento ao ver scripts ou dependências novas no `package.json`, e já houve casos de
projeto estático virar app Node por isso.

> **Atenção**: `/api/company` e `/api/cron-ntnb` **não foram espelhados** no `server.ps1` nem
> são exercitados pelo `server.js` sem a rota correspondente — `/api/company` dá 404 no dev
> local. A regra de espelhar segue valendo pros demais; essas duas ficaram de fora
> conscientemente, porque o `server.ps1` responde em ~26s desde que o projeto voltou pra Vercel.
