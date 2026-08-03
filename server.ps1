$port = if ($env:PORT) { $env:PORT } else { 3000 }
$root = $PSScriptRoot

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Servidor rodando em http://localhost:$port" -ForegroundColor Green

function ConvertFrom-HtmlEntities {
    param([string]$Text)
    if (-not $Text) { return '' }
    $t = $Text -replace '&apos;', "'" -replace '&quot;', '"' -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&'
    $t = [regex]::Replace($t, '&#x([0-9a-fA-F]+);', { param($m) [char]::ConvertFromUtf32([Convert]::ToInt32($m.Groups[1].Value, 16)) })
    $t = [regex]::Replace($t, '&#(\d+);', { param($m) [char]::ConvertFromUtf32([int]$m.Groups[1].Value) })
    return $t
}

function Get-CnbcTopStory {
    try {
        $wc = [System.Net.WebClient]::new()
        $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        $wc.Encoding = [System.Text.Encoding]::UTF8
        $html = $wc.DownloadString('https://www.cnbc.com/world/?region=world')

        $heroSection = [regex]::Match($html, '<div class="FeaturedNewsHero-container"[\s\S]*?<div class="SecondaryCardContainer-container">')
        $heroBlock = $heroSection.Value
        $heroTitle = [regex]::Match($heroBlock, '<h2 class="FeaturedCard-packagedCardTitle"><a href="([^"]+)"[^>]*>([\s\S]*?)</a></h2>')
        if (-not $heroTitle.Success) { return $null }
        $heroImg = [regex]::Match($heroBlock, '<img src="([^"]+)"')
        $subItems = @()
        foreach ($s in [regex]::Matches($heroBlock, '<a href="([^"]+)" class="PackageItem-link"[^>]*>([\s\S]*?)<!--')) {
            $subItems += [PSCustomObject]@{ link = ConvertFrom-HtmlEntities $s.Groups[1].Value; title = ConvertFrom-HtmlEntities $s.Groups[2].Value.Trim() }
        }
        $hero = [PSCustomObject]@{
            link = ConvertFrom-HtmlEntities $heroTitle.Groups[1].Value
            title = ConvertFrom-HtmlEntities $heroTitle.Groups[2].Value.Trim()
            image = ConvertFrom-HtmlEntities $heroImg.Groups[1].Value
            subItems = $subItems
        }

        $secondary = @()
        foreach ($s in ([regex]::Matches($html, '<div class="SecondaryCard-container">[\s\S]*?</div></div></li>') | Select-Object -First 4)) {
            $block = $s.Value
            $img = [regex]::Match($block, '<img src="([^"]+)"')
            $headline = [regex]::Match($block, '<div class="SecondaryCard-headline"><a href="([^"]+)"[^>]*>([\s\S]*?)</a>')
            if (-not $headline.Success) { continue }
            $secondary += [PSCustomObject]@{
                link = ConvertFrom-HtmlEntities $headline.Groups[1].Value
                title = ConvertFrom-HtmlEntities $headline.Groups[2].Value.Trim()
                image = ConvertFrom-HtmlEntities $img.Groups[1].Value
            }
        }
        return [PSCustomObject]@{ hero = $hero; secondary = $secondary }
    } catch {
        return $null
    }
}

function Get-XmlTag {
    param([string]$Block, [string]$Tag)
    $m = [regex]::Match($Block, "<$Tag[^>]*>([\s\S]*?)</$Tag>", 'IgnoreCase')
    if (-not $m.Success) { return '' }
    $val = $m.Groups[1].Value.Trim()
    $val = $val -replace '^<!\[CDATA\[([\s\S]*?)\]\]>$', '$1'
    $val = $val -replace '&apos;', "'" -replace '&quot;', '"' -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&'
    return $val.Trim()
}

function Get-NewsForTickers {
    param([string[]]$Tickers)
    $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    $seen = @{}
    $items = @()
    foreach ($t in $Tickers) {
        try {
            $url = "https://query1.finance.yahoo.com/v1/finance/search?q=$([Uri]::EscapeDataString($t))&newsCount=12&quotesCount=0"
            $wc = [System.Net.WebClient]::new()
            $wc.Headers.Add('User-Agent', $ua)
            $wc.Encoding = [System.Text.Encoding]::UTF8
            $raw = $wc.DownloadString($url)
            $data = $raw | ConvertFrom-Json
            foreach ($n in $data.news) {
                if (-not $n.uuid -or $seen.ContainsKey($n.uuid)) { continue }
                $seen[$n.uuid] = $true
                $items += [PSCustomObject]@{
                    title     = $n.title
                    publisher = $n.publisher
                    link      = $n.link
                    time      = $n.providerPublishTime
                }
            }
        } catch {}
    }
    $items = $items | Sort-Object -Property @{Expression = { $_.time }; Descending = $true }
    if ($items.Count -gt 20) { $items = $items[0..19] }
    return $items
}

function Get-MarketNews {
    return Get-NewsForTickers -Tickers @('^GSPC', '^DJI', '^IXIC')
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $res.KeepAlive = $false

    $path = $req.Url.LocalPath

    # ── Proxy ECB rate ──────────────────────────────────────────────────────
    if ($path -eq '/api/ecb') {
        $ecbUrl = "https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?format=jsondata&lastNObservations=1"
        try {
            $wc = [System.Net.WebClient]::new()
            $wc.Headers.Add('Accept', 'application/json')
            $raw = $wc.DownloadString($ecbUrl)
            $data = $raw | ConvertFrom-Json
            $seriesMap = $data.dataSets[0].series
            $sid = ($seriesMap | Get-Member -MemberType NoteProperty | Select-Object -First 1).Name
            $obs = $seriesMap.$sid.observations
            $key = ($obs | Get-Member -MemberType NoteProperty | Select-Object -First 1).Name
            $v = $obs.$key[0]
            $date = $data.structure.dimensions.observation[0].values[$key].id
            $result = "{`"v`":$v,`"date`":`"$date`"}"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message)`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Proxy Yahoo Price Target (crumb auth) ───────────────────────────────────
    if ($path -eq '/api/target') {
        $ticker = $req.QueryString['t']
        try {
            $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            $cookieJar = [System.Net.CookieContainer]::new()

            # Step 1 — get cookie from fc.yahoo.com
            $r1 = [System.Net.HttpWebRequest]::Create('https://fc.yahoo.com')
            $r1.CookieContainer = $cookieJar; $r1.UserAgent = $ua; $r1.Timeout = 8000
            try { $r1.GetResponse().Close() } catch {}

            # Step 2 — get crumb
            $r2 = [System.Net.HttpWebRequest]::Create('https://query2.finance.yahoo.com/v1/test/getcrumb')
            $r2.CookieContainer = $cookieJar; $r2.UserAgent = $ua; $r2.Accept = 'text/plain'; $r2.Timeout = 8000
            $crumb = [System.IO.StreamReader]::new($r2.GetResponse().GetResponseStream()).ReadToEnd()

            # Step 3 — quoteSummary
            $qUrl = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/$([Uri]::EscapeDataString($ticker))?modules=financialData&crumb=$([Uri]::EscapeDataString($crumb))"
            $r3 = [System.Net.HttpWebRequest]::Create($qUrl)
            $r3.CookieContainer = $cookieJar; $r3.UserAgent = $ua; $r3.Accept = 'application/json'; $r3.Timeout = 8000
            $raw = [System.IO.StreamReader]::new($r3.GetResponse().GetResponseStream()).ReadToEnd()

            $data = $raw | ConvertFrom-Json
            $fd   = $data.quoteSummary.result[0].financialData
            $targetMean  = $fd.targetMeanPrice.raw
            $targetHigh  = $fd.targetHighPrice.raw
            $targetLow   = $fd.targetLowPrice.raw
            $numAnalysts = $fd.numberOfAnalystOpinions.raw
            $rec         = $fd.recommendationKey
            $result = "{`"targetMean`":$targetMean,`"targetHigh`":$targetHigh,`"targetLow`":$targetLow,`"numAnalysts`":$numAnalysts,`"recommendation`":`"$rec`"}"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message)`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Feed de notícias · mercado americano ────────────────────────────────
    if ($path -eq '/api/news') {
        try {
            $tickerParam = $req.QueryString['t']
            if ($tickerParam) {
                $items = Get-NewsForTickers -Tickers @($tickerParam)
            } else {
                $items = Get-MarketNews
            }
            $result = @{ items = $items } | ConvertTo-Json -Depth 6
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $errMsg = $_.Exception.Message -replace '"', '\"'
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── CNBC · agregador de manchetes via RSS ────────────────────────────────
    if ($path -eq '/api/cnbc-news') {
        try {
            $feeds = @(
                @{ id = '100003114'; label = 'Top News' },
                @{ id = '100727362'; label = 'World' },
                @{ id = '15839069';  label = 'Markets' },
                @{ id = '19854910';  label = 'Technology' },
                @{ id = '10000664';  label = 'Finance' },
                @{ id = '20910258';  label = 'Economy' },
                @{ id = '19836768';  label = 'Energy' }
            )
            $seen = New-Object System.Collections.Generic.HashSet[string]
            $items = @()
            foreach ($feed in $feeds) {
                try {
                    $wc = [System.Net.WebClient]::new()
                    $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
                    $wc.Encoding = [System.Text.Encoding]::UTF8
                    $xml = $wc.DownloadString("https://www.cnbc.com/id/$($feed.id)/device/rss/rss.html")
                    $blocks = [regex]::Matches($xml, '<item>[\s\S]*?</item>')
                    foreach ($b in $blocks) {
                        $block = $b.Value
                        $title = Get-XmlTag $block 'title'
                        $link = Get-XmlTag $block 'link'
                        $desc = Get-XmlTag $block 'description'
                        $pubDate = Get-XmlTag $block 'pubDate'
                        if (-not $title -or -not $link) { continue }
                        if ($seen.Contains($link)) { continue }
                        [void]$seen.Add($link)
                        $time = $null
                        try { $time = [int][double]([DateTimeOffset]::Parse($pubDate)).ToUnixTimeSeconds() } catch {}
                        $items += [PSCustomObject]@{
                            title = $title; link = $link; publisher = "CNBC - $($feed.label)"
                            feed = $feed.label; time = $time; summary = $desc
                        }
                    }
                } catch {}
            }
            $topStory = Get-CnbcTopStory
            if ($topStory) {
                $highlighted = New-Object System.Collections.Generic.HashSet[string]
                [void]$highlighted.Add($topStory.hero.link)
                foreach ($s in $topStory.secondary) { [void]$highlighted.Add($s.link) }
                $items = $items | Where-Object { -not $highlighted.Contains($_.link) }
            }
            $items = $items | Sort-Object -Property time -Descending

            # Ultimas 24h - sem cortar por quantidade. Cada feed RSS da CNBC só traz os
            # ~30 itens mais recentes (sem paginação); em categorias de volume alto isso
            # pode cobrir bem menos que 24h de fato - reportamos a cobertura real (`coverage`).
            $dayAgo = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - (24 * 3600)
            $last24h = $items | Where-Object { $null -eq $_.time -or $_.time -ge $dayAgo }

            $coverage = @{}
            foreach ($feed in $feeds) {
                $feedItems = $items | Where-Object { $_.feed -eq $feed.label }
                if (-not $feedItems -or $feedItems.Count -eq 0) { continue }
                $oldest = ($feedItems | Select-Object -Last 1).time
                $hoursAvailable = $null
                if ($oldest) { $hoursAvailable = [Math]::Round((([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $oldest) / 3600.0), 1) }
                $coverage[$feed.label] = @{ count = $feedItems.Count; hoursAvailable = $hoursAvailable }
            }

            $result = @{ items = $last24h; topStory = $topStory; coverage = $coverage } | ConvertTo-Json -Depth 8
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $errMsg = $_.Exception.Message -replace '"', '\"'
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Bonds · histórico de preço via bondterminal.com ──────────────────────
    if ($path -eq '/api/bonds-history') {
        try {
            $isin = $req.QueryString['isin']
            $range = if ($req.QueryString['range']) { $req.QueryString['range'] } else { '1y' }
            if (-not $isin) { throw "isin obrigatório" }
            $wc = [System.Net.WebClient]::new()
            $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            $wc.Encoding = [System.Text.Encoding]::UTF8
            $json = $wc.DownloadString("https://bondterminal.com/api/bonds/$isin/market-history?range=$range")
            $d = $json | ConvertFrom-Json
            $result = @{ history = $d.price } | ConvertTo-Json -Depth 6
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $errMsg = $_.Exception.Message -replace '"', '\"'
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Bonds · preço via bondterminal.com (API interna, não-oficial) ────────
    if ($path -eq '/api/bonds') {
        try {
            $bonds = @(
                @{ region='Brasil'; label='Eletrobrás 30'; isin='USP22835AB13' },
                @{ region='Brasil'; label='Rede Dor 30'; isin='USL7915TAA09' },
                @{ region='Brasil'; label='Aegea 31'; isin='USL01343AB52' },
                @{ region='Brasil'; label='Banco do Brasil 31'; isin='USP2000TAE57' },
                @{ region='Brasil'; label='B3 31'; isin='USP19118AA91' },
                @{ region='Brasil'; label='LD Celulose 32'; isin='USA4S42PAA32' },
                @{ region='Brasil'; label='Suzano 31'; isin='US86964WAJ18' },
                @{ region='Brasil'; label='Brasil 31'; isin='US105756CE88' },
                @{ region='Brasil'; label='Bradesco 30'; isin='US05947LBB36' },
                @{ region='Brasil'; label='Usiminas 32'; isin='USL95806AB88' },
                @{ region='Brasil'; label='BTG 31'; isin='US05971BAM19' },
                @{ region='África/Ásia/Latam'; label='Cemex 30'; isin='USP2253TJQ33' },
                @{ region='África/Ásia/Latam'; label='Codelco 34'; isin='USP3143NBQ62' },
                @{ region='África/Ásia/Latam'; label='GCC 32'; isin='USP47465AB82' },
                @{ region='África/Ásia/Latam'; label='Cemex Perp'; isin='USP2253TJW01' },
                @{ region='África/Ásia/Latam'; label='BBVA México'; isin='USP2000GAA15' }
            )
            $apiKey = $env:BONDS_API_KEY
            if (-not $apiKey) {
                # Sem a chave, ainda devolve o esqueleto completo (region/label/isin) pro
                # front-end poder cair pro cache local em vez de ficar sem nenhum ISIN.
                $skeleton = $bonds | ForEach-Object { [PSCustomObject]@{ region = $_.region; label = $_.label; isin = $_.isin; available = $false } }
                $result = @{ bonds = $skeleton; totalRequested = $bonds.Count; totalAvailable = 0; error = 'BONDS_API_KEY não configurada (defina no ambiente local)' } | ConvertTo-Json -Depth 10
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
                $res.ContentType = 'application/json; charset=utf-8'
                $res.Headers.Add('Access-Control-Allow-Origin', '*')
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
                $res.OutputStream.Close()
                continue
            }
            $results = @()
            foreach ($b in $bonds) {
                $found = $false
                for ($attempt = 0; $attempt -lt 3; $attempt++) {
                    try {
                        $wc = [System.Net.WebClient]::new()
                        $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
                        $wc.Headers.Add('Authorization', "Bearer $apiKey")
                        $wc.Encoding = [System.Text.Encoding]::UTF8
                        $json = $wc.DownloadString("https://bondterminal.com/api/v1/bonds/$($b.isin)/analytics")
                        $d = $json | ConvertFrom-Json
                        if ($null -ne $d.price) {
                            $results += [PSCustomObject]@{
                                region = $b.region; label = $b.label; isin = $b.isin; available = $true
                                price = $d.price; priceDate = $d.market.timestamp
                                changePercent = $d.market.change.percent1D
                                ytw = $d.yields.ytw; duration = $d.risk.modifiedDuration; gSpread = $d.spreads.gSpread
                                analytics = $d
                            }
                            $found = $true
                            break
                        }
                    } catch {}
                    if ($attempt -lt 2) { Start-Sleep -Milliseconds 500 }
                }
                if (-not $found) {
                    $results += [PSCustomObject]@{ region = $b.region; label = $b.label; isin = $b.isin; available = $false }
                }
            }
            $totalAvailable = ($results | Where-Object { $_.available }).Count
            $result = @{ bonds = $results; totalRequested = $bonds.Count; totalAvailable = $totalAvailable } | ConvertTo-Json -Depth 10
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $errMsg = $_.Exception.Message -replace '"', '\"'
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Busca de ativos/índices (resolve texto livre em tickers) ────────────
    if ($path -eq '/api/quote-search') {
        try {
            $q = $req.QueryString['q']
            if (-not $q) { throw "q obrigatório" }
            $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            $url = "https://query1.finance.yahoo.com/v1/finance/search?q=$([Uri]::EscapeDataString($q))&quotesCount=8&newsCount=0"
            $wc = [System.Net.WebClient]::new()
            $wc.Headers.Add('User-Agent', $ua)
            $wc.Encoding = [System.Text.Encoding]::UTF8
            $raw = $wc.DownloadString($url)
            $data = $raw | ConvertFrom-Json
            $quotes = @()
            foreach ($item in $data.quotes) {
                if (-not $item.symbol) { continue }
                $name = if ($item.shortname) { $item.shortname } elseif ($item.longname) { $item.longname } else { $item.symbol }
                $exch = if ($item.exchDisp) { $item.exchDisp } elseif ($item.exchange) { $item.exchange } else { '' }
                $quotes += [PSCustomObject]@{ symbol = $item.symbol; name = $name; exchange = $exch; type = $item.quoteType }
            }
            $result = @{ quotes = $quotes } | ConvertTo-Json -Depth 6
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $errMsg = $_.Exception.Message -replace '"', '\"'
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Resumo de IA · principais notícias do dia (OpenAI) ──────────────────
    if ($path -eq '/api/summary') {
        try {
            $apiKey = $env:OPENAI_API_KEY
            if (-not $apiKey) { throw "OPENAI_API_KEY não configurada no ambiente local" }

            $news = Get-MarketNews
            if ($news.Count -eq 0) { throw "sem notícias disponíveis para resumir" }

            $headlines = ($news | Select-Object -First 15 | ForEach-Object { "- $($_.title) ($($_.publisher))" }) -join "`n"
            $prompt = "Você é um analista de mercado escrevendo para um terminal financeiro. Com base apenas nas manchetes abaixo sobre o mercado americano de hoje, escreva um resumo em português (Brasil), em 3 a 5 frases, direto e objetivo, destacando os principais temas, movimentos e riscos do dia. Não invente fatos além do que está nas manchetes.`n`nManchetes:`n$headlines"

            $body = @{
                model       = 'gpt-4o-mini'
                messages    = @(@{ role = 'user'; content = $prompt })
                temperature = 0.4
                max_tokens  = 350
            } | ConvertTo-Json -Depth 5

            $wc = [System.Net.WebClient]::new()
            $wc.Headers.Add('Content-Type', 'application/json')
            $wc.Headers.Add('Authorization', "Bearer $apiKey")
            $wc.Encoding = [System.Text.Encoding]::UTF8
            $rawResp = $wc.UploadString('https://api.openai.com/v1/chat/completions', 'POST', $body)
            $respData = $rawResp | ConvertFrom-Json
            $summary = $respData.choices[0].message.content.Trim()
            if (-not $summary) { throw "resposta vazia da OpenAI" }

            $result = @{ summary = $summary; generatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $errMsg = $_.Exception.Message -replace '"', '\"'
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Resumir uma notícia específica (Gemini · sob demanda) ────────────────
    if ($path -eq '/api/summarize-news') {
        try {
            $apiKey = $env:GEMINI_API_KEY
            if (-not $apiKey) { throw "GEMINI_API_KEY não configurada no ambiente local" }

            $newsUrl = $req.QueryString['url']
            $title   = $req.QueryString['title']
            if (-not $newsUrl) { throw "url obrigatória" }

            # Busca o HTML da própria notícia (mesma técnica das outras rotas) e extrai o texto disponível
            $articleText = ''
            try {
                $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                $wcPage = [System.Net.WebClient]::new()
                $wcPage.Headers.Add('User-Agent', $ua)
                $wcPage.Encoding = [System.Text.Encoding]::UTF8
                $html = $wcPage.DownloadString($newsUrl)
                $html = $html -replace '(?is)<script.*?</script>', '' -replace '(?is)<style.*?</style>', ''

                $ogDesc = ''
                $ogMatch = [regex]::Match($html, '(?is)<meta[^>]+property=["'']og:description["''][^>]+content=["'']([^"'']+)["'']')
                if ($ogMatch.Success) { $ogDesc = [System.Net.WebUtility]::HtmlDecode($ogMatch.Groups[1].Value).Trim() }

                $paras = [regex]::Matches($html, '(?is)<p[^>]*>(.*?)</p>') | ForEach-Object {
                    $t = $_.Groups[1].Value -replace '(?is)<[^>]+>', ' '
                    $t = [System.Net.WebUtility]::HtmlDecode($t) -replace '\s+', ' '
                    $t.Trim()
                } | Where-Object { $_.Length -gt 40 }
                $bodyText = ($paras -join "`n")
                if ($bodyText.Length -gt 4000) { $bodyText = $bodyText.Substring(0, 4000) }

                $articleText = if ($bodyText.Length -gt 200) { $bodyText } else { $ogDesc }
            } catch { $articleText = '' }

            if ($articleText) {
                $prompt = "Resuma esta notícia em português (Brasil), em 2 a 4 frases, direto e objetivo, focando no que é relevante para o mercado financeiro. Baseie-se apenas no texto abaixo, extraído de uma página pública do Yahoo Finance.`n`nTítulo: $title`n`nTexto disponível:`n$articleText"
            } else {
                $prompt = "Não foi possível extrair o texto completo desta notícia (pode ser conteúdo restrito ou renderizado via JavaScript). Com base apenas no título abaixo, escreva 1 a 2 frases em português (Brasil) explicando objetivamente o que essa manchete provavelmente significa para o mercado financeiro. Não invente detalhes específicos, números, nomes ou datas que não estão no título, seja genérico onde faltar informação.`n`nTítulo: $title"
            }

            $body = @{
                contents = @(@{ parts = @(@{ text = $prompt }) })
            } | ConvertTo-Json -Depth 6

            $geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$([Uri]::EscapeDataString($apiKey))"
            $wc = [System.Net.WebClient]::new()
            $wc.Headers.Add('Content-Type', 'application/json')
            $wc.Encoding = [System.Text.Encoding]::UTF8
            try {
                $rawResp = $wc.UploadString($geminiUrl, 'POST', $body)
            } catch [System.Net.WebException] {
                $statusCode = 0
                if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
                if ($statusCode -eq 429) {
                    $result = '{"error":"rate_limit"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
                    $res.StatusCode = 429
                    $res.ContentType = 'application/json; charset=utf-8'
                    $res.Headers.Add('Access-Control-Allow-Origin', '*')
                    $res.ContentLength64 = $bytes.Length
                    $res.OutputStream.Write($bytes, 0, $bytes.Length)
                    $res.OutputStream.Close()
                    continue
                }
                throw
            }
            $respData = $rawResp | ConvertFrom-Json
            $parts = $respData.candidates[0].content.parts
            $summary = (($parts | Where-Object { $_.text }) | ForEach-Object { $_.text }) -join ''
            $summary = $summary.Trim()
            if (-not $summary) { throw "resposta vazia do Gemini" }

            $result = @{ summary = $summary } | ConvertTo-Json
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $errMsg = $_.Exception.Message -replace '"', '\"'
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Proxy Yahoo Finance ──────────────────────────────────────────────────
    if ($path -eq '/api/yahoo') {
        $ticker   = $req.QueryString['t']
        $range    = if ($req.QueryString['range']) { $req.QueryString['range'] } else { '5d' }
        $interval = if ($req.QueryString['interval']) { $req.QueryString['interval'] } else { '1d' }
        $yUrl   = "https://query1.finance.yahoo.com/v8/finance/chart/$([Uri]::EscapeDataString($ticker))?range=$range&interval=$interval&includePrePost=false"
        try {
            $wc = [System.Net.WebClient]::new()
            $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
            $wc.Headers.Add('Accept', 'application/json')
            $body = $wc.DownloadData($yUrl)
            $res.ContentType = 'application/json'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $body.Length
            $res.OutputStream.Write($body, 0, $body.Length)
        } catch {
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message)`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Proxy B3 DI Futuro ──────────────────────────────────────────────────
    if ($path -eq '/api/b3') {
        $symbol = if ($req.QueryString['s']) { $req.QueryString['s'] } else { 'DI1F30' }
        $b3Url = "https://cotacao.b3.com.br/mds/api/v1/InstrumentQuotation/$([Uri]::EscapeDataString($symbol))"
        try {
            $wc = [System.Net.WebClient]::new()
            $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
            $wc.Headers.Add('Accept', 'application/json')
            $raw = $wc.DownloadString($b3Url)
            $data = $raw | ConvertFrom-Json
            if ($data.BizSts.cd -ne 'OK' -or -not $data.Trad) { throw "B3: sem dados" }
            $qtn = $data.Trad[0].scty.SctyQtn
            $result = "{`"price`":$($qtn.curPrc),`"open`":$($qtn.opngPric),`"date`":`"$($data.Msg.dtTm)`"}"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message)`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Proxy ANBIMA NTN-B ──────────────────────────────────────────────────
    if ($path -eq '/api/ntnb') {
        try {
            $targets = @('20280815', '20290515', '20300815', '20320815', '20350515', '20450515')
            $today = Get-Date
            $dates = @()
            $d = $today
            while ($dates.Count -lt 5) {
                if ($d.DayOfWeek -ne 'Saturday' -and $d.DayOfWeek -ne 'Sunday') { $dates += $d }
                $d = $d.AddDays(-1)
            }
            $result = $null
            foreach ($dt in $dates) {
                $yy = $dt.ToString('yy')
                $mm = $dt.ToString('MM')
                $dd = $dt.ToString('dd')
                $ntnbUrl = "https://www.anbima.com.br/informacoes/merc-sec/arqs/ms$yy$mm$dd.txt"
                try {
                    $wc = [System.Net.WebClient]::new()
                    $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
                    $csvText = $wc.DownloadString($ntnbUrl)
                    $rates = @{}
                    foreach ($line in ($csvText -split "`n")) {
                        $cols = $line.Trim() -split '@'
                        if ($cols.Count -lt 8) { continue }
                        if ($cols[0].Trim() -ne 'NTN-B') { continue }
                        $mat = $cols[4].Trim()
                        if ($targets -contains $mat) {
                            $rate = [double]($cols[7].Trim().Replace(',','.'))
                            $year = $mat.Substring(0,4)
                            $rates[$year] = $rate
                        }
                    }
                    if ($rates.Count -gt 0) {
                        $dtStr = $dt.ToString('dd/MM/yyyy')
                        $ratesJson = ($rates.GetEnumerator() | ForEach-Object { "`"$($_.Key)`":$($_.Value)" }) -join ','
                        $result = "{`"rates`":{$ratesJson},`"date`":`"$dtStr`"}"
                        break
                    }
                } catch {}
            }
            if ($result) {
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
                $res.ContentType = 'application/json'
                $res.Headers.Add('Access-Control-Allow-Origin', '*')
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $err = [System.Text.Encoding]::UTF8.GetBytes('{"error":"NTN-B: sem dados"}')
                $res.StatusCode = 500
                $res.ContentType = 'application/json'
                $res.ContentLength64 = $err.Length
                $res.OutputStream.Write($err, 0, $err.Length)
            }
        } catch {
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message)`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Proxy ANBIMA NTN-B · histórico ───────────────────────────────────────
    if ($path -eq '/api/ntnb-history') {
        try {
            $targets = @('20280815', '20290515', '20300815', '20320815', '20350515', '20450515')
            $reqDays = [int]($req.QueryString['days'])
            if ($reqDays -le 0) { $reqDays = 65 }
            if ($reqDays -gt 260) { $reqDays = 260 }
            $allBizDays = @()
            $d = Get-Date
            while ($allBizDays.Count -lt $reqDays) {
                if ($d.DayOfWeek -ne 'Saturday' -and $d.DayOfWeek -ne 'Sunday') { $allBizDays += $d }
                $d = $d.AddDays(-1)
            }
            # amostra 1 em cada N dias pra janelas grandes (6M/1A), limitando o total de
            # requisições à ANBIMA a ~90 no pior caso (mesma lógica do api/ntnb-history.js)
            $stride = [Math]::Max(1, [Math]::Ceiling($reqDays / 90.0))
            $dates = @()
            for ($i = 0; $i -lt $allBizDays.Count; $i += $stride) { $dates += $allBizDays[$i] }
            $history = @()
            foreach ($dt in $dates) {
                $yy = $dt.ToString('yy'); $mm = $dt.ToString('MM'); $dd = $dt.ToString('dd')
                $ntnbUrl = "https://www.anbima.com.br/informacoes/merc-sec/arqs/ms$yy$mm$dd.txt"
                try {
                    $wc = [System.Net.WebClient]::new()
                    $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
                    $csvText = $wc.DownloadString($ntnbUrl)
                    $rates = @{}
                    foreach ($line in ($csvText -split "`n")) {
                        $cols = $line.Trim() -split '@'
                        if ($cols.Count -lt 8) { continue }
                        if ($cols[0].Trim() -ne 'NTN-B') { continue }
                        $mat = $cols[4].Trim()
                        if ($targets -contains $mat) {
                            $rate = [double]($cols[7].Trim().Replace(',','.'))
                            $rates[$mat.Substring(0,4)] = $rate
                        }
                    }
                    if ($rates.Count -gt 0) {
                        $dtStr = $dt.ToString('dd/MM/yyyy')
                        $ratesJson = ($rates.GetEnumerator() | ForEach-Object { "`"$($_.Key)`":$($_.Value)" }) -join ','
                        $history += "{`"date`":`"$dtStr`",`"rates`":{$ratesJson}}"
                    }
                } catch {}
            }
            if ($history.Count -gt 0) {
                [array]::Reverse($history)
                $result = "{`"history`":[$($history -join ',')]}"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
                $res.ContentType = 'application/json'
                $res.Headers.Add('Access-Control-Allow-Origin', '*')
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $err = [System.Text.Encoding]::UTF8.GetBytes('{"error":"NTN-B: sem dados no periodo"}')
                $res.StatusCode = 500
                $res.ContentType = 'application/json'
                $res.ContentLength64 = $err.Length
                $res.OutputStream.Write($err, 0, $err.Length)
            }
        } catch {
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message)`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Proxy ANBIMA ETTJ ────────────────────────────────────────────────────
    if ($path -eq '/api/anbima') {
        try {
            $today = Get-Date
            $dates = @()
            $d = $today
            while ($dates.Count -lt 5) {
                if ($d.DayOfWeek -ne 'Saturday' -and $d.DayOfWeek -ne 'Sunday') {
                    $dates += $d.ToString('dd/MM/yyyy')
                }
                $d = $d.AddDays(-1)
            }

            $result = $null
            foreach ($dt in $dates) {
                try {
                    $postBody = "Idioma=PT&Dt_Ref=$([Uri]::EscapeDataString($dt))&saida=csv"
                    $wc = [System.Net.WebClient]::new()
                    $wc.Headers.Add('Content-Type', 'application/x-www-form-urlencoded')
                    $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
                    $wc.Headers.Add('Referer', 'https://www.anbima.com.br/informacoes/est-termo/CZ.asp')
                    $rawBytes = $wc.UploadData('https://www.anbima.com.br/informacoes/est-termo/CZ-down.asp', 'POST', [System.Text.Encoding]::UTF8.GetBytes($postBody))
                    $csvText = [System.Text.Encoding]::UTF8.GetString($rawBytes)

                    $sep = if ($csvText.Contains(';')) { ';' } else { ',' }
                    foreach ($line in ($csvText -split "`n")) {
                        $cols = $line.Trim() -split [regex]::Escape($sep)
                        $v = $cols[0].Trim().Trim('"')
                        if ($v -eq '252' -or $v -eq '252.0') {
                            $ipca = [double]($cols[1].Trim().Trim('"').Replace(',','.'))
                            $pre  = [double]($cols[2].Trim().Trim('"').Replace(',','.'))
                            $inf  = [double]($cols[3].Trim().Trim('"').Replace(',','.'))
                            $result = "{`"ettjIpca`":$ipca,`"ettjPre`":$pre,`"infImpl`":$inf,`"date`":`"$dt`"}"
                            break
                        }
                    }
                    if ($result) { break }
                } catch {}
            }

            if ($result) {
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
                $res.ContentType = 'application/json'
                $res.Headers.Add('Access-Control-Allow-Origin', '*')
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $err = [System.Text.Encoding]::UTF8.GetBytes('{"error":"ANBIMA: sem dados"}')
                $res.StatusCode = 500
                $res.ContentType = 'application/json'
                $res.ContentLength64 = $err.Length
                $res.OutputStream.Write($err, 0, $err.Length)
            }
        } catch {
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message)`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Arquivos estáticos ───────────────────────────────────────────────────
    $file = if ($path -eq '/' -or $path -eq '') { 'index.html' } else { $path.TrimStart('/') }
    $full = Join-Path $root $file

    try {
        if (Test-Path $full -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($full).ToLower()
            $res.ContentType = switch ($ext) {
                '.html' { 'text/html; charset=utf-8' }
                '.js'   { 'application/javascript' }
                '.css'  { 'text/css' }
                '.json' { 'application/json' }
                '.svg'  { 'image/svg+xml' }
                '.png'  { 'image/png' }
                '.ico'  { 'image/x-icon' }
                default { 'application/octet-stream' }
            }
            $bytes = [System.IO.File]::ReadAllBytes($full)
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
            $res.ContentLength64 = $msg.Length
            $res.OutputStream.Write($msg, 0, $msg.Length)
        }
    } catch {
        Write-Host "Erro servindo $($path): $($_.Exception.Message)" -ForegroundColor Red
    }
    try { $res.OutputStream.Close() } catch {}
}
