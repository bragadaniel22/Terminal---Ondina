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

# Busca o fechamento anterior oficial via quoteSummary (crumb auth, mesma técnica do
# /api/target) — espelho de fetchOfficialPreviousClose em api/yahoo.js. Usado só quando o
# chart endpoint não traz regularMarketPreviousClose/previousClose no meta (comum em
# futuros de commodities tipo GC=F/CL=F/BZ=F, que operam quase 24h e cujo bucket diário do
# chart não bate com o fechamento oficial da bolsa — causava % de variação errada, ex: ouro
# mostrando +1,3% no terminal quando na realidade estava -0,06%).
function Get-YahooOfficialPreviousClose {
    param([string]$Ticker)
    $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    $cookieJar = [System.Net.CookieContainer]::new()
    $r1 = [System.Net.HttpWebRequest]::Create('https://fc.yahoo.com')
    $r1.CookieContainer = $cookieJar; $r1.UserAgent = $ua; $r1.Timeout = 8000
    try { $r1.GetResponse().Close() } catch {}
    $r2 = [System.Net.HttpWebRequest]::Create('https://query2.finance.yahoo.com/v1/test/getcrumb')
    $r2.CookieContainer = $cookieJar; $r2.UserAgent = $ua; $r2.Accept = 'text/plain'; $r2.Timeout = 8000
    $crumb = [System.IO.StreamReader]::new($r2.GetResponse().GetResponseStream()).ReadToEnd()
    if (-not $crumb -or $crumb.Contains('<') -or $crumb.Length -gt 20) { throw "crumb inválido" }
    $qUrl = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/$([Uri]::EscapeDataString($Ticker))?modules=price&crumb=$([Uri]::EscapeDataString($crumb))"
    $r3 = [System.Net.HttpWebRequest]::Create($qUrl)
    $r3.CookieContainer = $cookieJar; $r3.UserAgent = $ua; $r3.Accept = 'application/json'; $r3.Timeout = 8000
    $raw = [System.IO.StreamReader]::new($r3.GetResponse().GetResponseStream()).ReadToEnd()
    $prev = ($raw | ConvertFrom-Json).quoteSummary.result[0].price.regularMarketPreviousClose.raw
    if ($null -eq $prev) { throw "sem regularMarketPreviousClose" }
    return $prev
}

# Busca o vértice 252 da ETTJ (Pré/IPCA/Inflação Implícita) num único dia — espelho de
# fetchOneDay em api/anbima.js. Devolve $null (não lança) em qualquer falha, pra permitir
# busca-pra-trás em Get-EttjNear sem try/catch aninhado em cada chamador.
function Get-EttjOneDay {
    param([string]$Dt)
    try {
        $postBody = "Idioma=PT&Dt_Ref=$([Uri]::EscapeDataString($Dt))&saida=csv"
        $wc = [System.Net.WebClient]::new()
        $wc.Headers.Add('Content-Type', 'application/x-www-form-urlencoded')
        $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        $wc.Headers.Add('Referer', 'https://www.anbima.com.br/informacoes/est-termo/CZ.asp')
        $rawBytes = $wc.UploadData('https://www.anbima.com.br/informacoes/est-termo/CZ-down.asp', 'POST', [System.Text.Encoding]::UTF8.GetBytes($postBody))
        $csvText = [System.Text.Encoding]::UTF8.GetString($rawBytes)
        if (-not $csvText -or $csvText.Length -lt 100) { return $null }

        $sep = if ($csvText.Contains(';')) { ';' } else { ',' }
        foreach ($line in ($csvText -split "`n")) {
            $cols = $line.Trim() -split [regex]::Escape($sep)
            $v = $cols[0].Trim().Trim('"')
            if ($v -eq '252' -or $v -eq '252.0') {
                $ipca = [double]($cols[1].Trim().Trim('"').Replace(',', '.'))
                $pre  = [double]($cols[2].Trim().Trim('"').Replace(',', '.'))
                $inf  = [double]($cols[3].Trim().Trim('"').Replace(',', '.'))
                return [PSCustomObject]@{ ettjIpca = $ipca; ettjPre = $pre; infImpl = $inf; date = $Dt }
            }
        }
        return $null
    } catch {
        return $null
    }
}

# Espelho de businessDaysBackFrom em api/anbima.js — gera N datas úteis (dd/MM/yyyy) a partir
# de (e incluindo) $StartDate, andando pra trás dia a dia e pulando fim de semana.
function Get-BusinessDaysBack {
    param([datetime]$StartDate, [int]$Count)
    $list = [System.Collections.Generic.List[string]]::new()
    $d = $StartDate
    while ($list.Count -lt $Count) {
        if ($d.DayOfWeek -ne 'Saturday' -and $d.DayOfWeek -ne 'Sunday') {
            $list.Add($d.ToString('dd/MM/yyyy'))
        }
        $d = $d.AddDays(-1)
    }
    return $list
}

# Espelho de fetchDayFile em api/ntnb.js — baixa e faz o parse de um único arquivo diário da
# ANBIMA (traz as 6 taxas NTN-B de uma vez). Devolve $null (não lança) em qualquer falha.
function Get-NtnbDayFile {
    param([datetime]$Dt)
    try {
        $targets = @('20280815', '20290515', '20300815', '20320815', '20350515', '20450515')
        $yy = $Dt.ToString('yy'); $mm = $Dt.ToString('MM'); $dd = $Dt.ToString('dd')
        $ntnbUrl = "https://www.anbima.com.br/informacoes/merc-sec/arqs/ms$yy$mm$dd.txt"
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
                $rate = [double]($cols[7].Trim().Replace(',', '.'))
                $rates[$mat.Substring(0, 4)] = $rate
            }
        }
        if ($rates.Count -eq 0) { return $null }
        return $rates
    } catch {
        return $null
    }
}

# Espelho de fetchNtnbNear em api/ntnb.js — usado pelo relatório de Fechamento (?dates=) pra
# resolver as taxas NTN-B em datas de referência específicas, tolerando feriado.
function Get-NtnbNear {
    param([string]$DateStr, [int]$MaxTries = 3)
    if ($DateStr -notmatch '^(\d{2})/(\d{2})/(\d{4})$') { return $null }
    $anchor = [datetime]::new([int]$Matches[3], [int]$Matches[2], [int]$Matches[1])
    foreach ($dtStr in (Get-BusinessDaysBack -StartDate $anchor -Count $MaxTries)) {
        $dt = [datetime]::ParseExact($dtStr, 'dd/MM/yyyy', [System.Globalization.CultureInfo]::InvariantCulture)
        $rates = Get-NtnbDayFile -Dt $dt
        if ($rates) { return [PSCustomObject]@{ date = $dtStr; rates = $rates } }
    }
    return $null
}

# Espelho de handleStaticAnchors em api/ntnb.js — lê "Taxas Antigas NTNB.xlsx" (raiz do repo)
# direto do .xlsx (é um zip de XML por baixo do capô), sem depender de nenhuma lib de Excel:
# workbook.xml resolve nome-da-aba -> r:id, workbook.xml.rels resolve r:id -> arquivo da aba,
# sharedStrings.xml resolve os índices de texto, e a aba em si (sheetN.xml) tem os valores.
# Estrutura fixa da planilha: data de referência em C2, vencimentos em C5:C10, taxas em D5:D10.
function ConvertTo-NtnbAnchorJson([PSCustomObject]$Anchor) {
    if (-not $Anchor) { return 'null' }
    $ratesJson = ($Anchor.rates.GetEnumerator() | ForEach-Object { "`"$($_.Key)`":$($_.Value)" }) -join ','
    return "{`"date`":`"$($Anchor.date)`",`"rates`":{$ratesJson}}"
}

function Get-NtnbStaticAnchors {
    param([string]$Path)
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
        try {
            # Encoding UTF-8 explícito é obrigatório aqui — sem isso, nomes de aba com acento
            # (ex: "Mês Anterior") saem corrompidos do StreamReader e a busca por nome falha
            # silenciosamente (mesma classe de bug já documentada pro WebClient — seção 3 da
            # METODOLOGIA — só que aqui é o StreamReader).
            function Read-ZipEntryText([string]$EntryName) {
                $entry = $zip.Entries | Where-Object { $_.FullName -eq $EntryName }
                if (-not $entry) { return $null }
                $sr = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
                try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
            }

            $sharedStringsXml = Read-ZipEntryText 'xl/sharedStrings.xml'
            $sharedStrings = @()
            if ($sharedStringsXml) {
                $sharedStrings = [regex]::Matches($sharedStringsXml, '<si>(.*?)</si>', 'Singleline') | ForEach-Object {
                    $_.Groups[1].Value -replace '<[^>]+>', ''
                }
            }

            $wbXml = Read-ZipEntryText 'xl/workbook.xml'
            $sheetToRid = @{}
            foreach ($m in [regex]::Matches($wbXml, '<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"')) {
                $sheetToRid[$m.Groups[1].Value] = $m.Groups[2].Value
            }
            $relsXml = Read-ZipEntryText 'xl/_rels/workbook.xml.rels'
            $ridToTarget = @{}
            foreach ($m in [regex]::Matches($relsXml, '<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"')) {
                $ridToTarget[$m.Groups[1].Value] = $m.Groups[2].Value
            }

            function Get-CellValue([string]$SheetXml, [string]$Ref) {
                $m = [regex]::Match($SheetXml, "<c r=`"$Ref`"[^>]*/>|<c r=`"$Ref`"[^>]*>.*?</c>", 'Singleline')
                if (-not $m.Success) { return $null }
                $block = $m.Value
                $vMatch = [regex]::Match($block, '<v>([^<]*)</v>')
                if (-not $vMatch.Success) { return $null }
                $raw = $vMatch.Groups[1].Value
                if ($block -match 't="s"') { return $sharedStrings[[int]$raw] }
                return [double]$raw
            }

            function Read-StaticSheet([string]$SheetName) {
                $rid = $sheetToRid[$SheetName]
                if (-not $rid) { return $null }
                $target = $ridToTarget[$rid]
                $sheetXml = Read-ZipEntryText "xl/$target"
                if (-not $sheetXml) { return $null }

                $dateSerial = Get-CellValue $sheetXml 'C2'
                if ($null -eq $dateSerial) { return $null }
                # serial de data do Excel: dias desde 30/12/1899 (base 1900, já compensando o
                # bug histórico do "29/02/1900" que o Excel herdou do Lotus 1-2-3)
                $date = ([datetime]::new(1899, 12, 30)).AddDays([double]$dateSerial)

                $rates = @{}
                foreach ($row in 5..10) {
                    $label = Get-CellValue $sheetXml "C$row"
                    $val = Get-CellValue $sheetXml "D$row"
                    if ($label -and $null -ne $val) {
                        $year = ($label -replace '\D', '')
                        $rates[$year] = [double]$val * 100.0
                    }
                }
                if ($rates.Count -eq 0) { return $null }
                return [PSCustomObject]@{ date = $date.ToString('dd/MM/yyyy'); rates = $rates }
            }

            # Evita comparar contra o literal acentuado "Mês Anterior" diretamente: o Windows
            # PowerShell 5.1 lê arquivo .ps1 sem BOM usando o codepage do sistema, não UTF-8 — o
            # literal viraria "MÃªs Anterior" em tempo de execução e nunca bateria com o nome
            # correto extraído do .xlsx (que esse mesmo bloco já lê como UTF-8 de verdade via
            # Read-ZipEntryText). Identifica as abas pela ordem/padrão do nome em vez do texto
            # exato, o que também sobrevive se o Daniel renomear os acentos de outro jeito.
            $monthSheetName = $sheetToRid.Keys | Where-Object { $_ -notlike 'Ano*' -and $_ -like '*Anterior' } | Select-Object -First 1
            $yearSheetName = $sheetToRid.Keys | Where-Object { $_ -like 'Ano*' } | Select-Object -First 1
            $month = if ($monthSheetName) { Read-StaticSheet $monthSheetName } else { $null }
            $year = if ($yearSheetName) { Read-StaticSheet $yearSheetName } else { $null }
            if (-not $month -and -not $year) { return $null }
            return [PSCustomObject]@{ month = $month; year = $year }
        } finally {
            $zip.Dispose()
        }
    } catch {
        return $null
    }
}

# ── Espelho de api/bonds.js (Bonds Terminal.xlsx) ────────────────────────────
# Converte número de coluna (1-based) pra letra de coluna do Excel (1->A, 27->AA, ...).
function ConvertTo-ColLetter([int]$N) {
    $s = ''
    while ($N -gt 0) {
        $rem = ($N - 1) % 26
        $s = [char](65 + $rem) + $s
        $N = [int](($N - 1) / 26)
    }
    return $s
}

# Monta um hashtable ref-de-célula -> valor pra aba inteira. A aba "Bid Yield" tem ~300 mil
# células (233 colunas x ~1300 linhas) — buscar célula por célula com Regex.Match direto na
# string XML inteira (como Get-NtnbStaticAnchors faz pra planilha pequena da NTN-B) ficaria
# lento demais aqui.
#
# Bug real encontrado nessa sessão: rodar o regex de célula (`<c r="...">...</c>`) numa ÚNICA
# passada sobre a string XML inteira (~5MB) perdia células silenciosamente — testado e
# confirmado num caso real (célula A10 da aba "Bid Yield" desaparecia do mapa mesmo com XML
# válido, `<c r="A10" s="2"><v>46245</v></c>` igualzinho a outras que funcionavam). O MESMO
# padrão de regex, rodado num trecho pequeno isolado com a mesma estrutura, casava certo — o
# problema só aparece em documentos muito grandes com "Regex.Matches" processando o padrão não-
# greedy `(.*?)` de ponta a ponta. **Corrigido em duas passadas**: primeiro separa por `<row>`
# (bem menor cada, curto-circuita o range de busca do não-greedy), depois casa células DENTRO
# de cada linha. Mais robusto e continua O(n).
function ConvertTo-XlsxCellMap([string]$SheetXml, [string[]]$SharedStrings) {
    $map = @{}
    # Segundo bug real nessa sessão: células vazias-mas-estilizadas o Excel escreve como tag
    # AUTOFECHADA (`<c r="C1" s="138"/>`, sem `</c>`) — comum em colunas "espaçador" entre
    # blocos que só têm formatação, sem dado nenhum. O regex antigo (só `<c r="..."...>(.*?)</c>`)
    # não reconhecia isso: ao tentar casar a tag autofechada como se fosse aberta, o `(.*?)`
    # não-greedy "vazava" através dela e das próximas tags autofechadas até achar o primeiro
    # `</c>` de verdade — atribuindo o VALOR DE UMA CÉLULA VIZINHA à célula errada (confirmado
    # ao vivo: "C1" recebia o valor real de "E1"). Corrigido com alternância: casa a forma
    # autofechada primeiro (sem valor, ignora) OU a forma aberta+conteúdo+fechamento.
    foreach ($rowMatch in [regex]::Matches($SheetXml, '<row[^>]*>(.*?)</row>', 'Singleline')) {
        $rowContent = $rowMatch.Groups[1].Value
        $cellPattern = '<c r="([A-Z]+\d+)"[^>]*/>|<c r="([A-Z]+\d+)"([^>]*)>(.*?)</c>'
        foreach ($m in [regex]::Matches($rowContent, $cellPattern, 'Singleline')) {
            if ($m.Groups[1].Success) { continue } # autofechada, sem valor — nada a guardar
            $ref = $m.Groups[2].Value
            $attrs = $m.Groups[3].Value
            $vMatch = [regex]::Match($m.Groups[4].Value, '<v>([^<]*)</v>')
            if (-not $vMatch.Success) { continue }
            $raw = $vMatch.Groups[1].Value
            if ($attrs -match 't="s"') {
                $idx = [int]$raw
                $map[$ref] = if ($idx -ge 0 -and $idx -lt $SharedStrings.Count) { $SharedStrings[$idx] } else { $null }
            } elseif ($attrs -match 't="str"' -or $attrs -match 't="inlineStr"' -or $attrs -match 't="e"') {
                # "str" = resultado de fórmula (texto), "inlineStr" = string inline (rara),
                # "e" = célula com erro (#NOME? etc.) — nenhum desses é número, guarda como texto.
                $map[$ref] = $raw
            } else {
                $map[$ref] = [double]$raw
            }
        }
    }
    return $map
}

# Boilerplate comum de resolução de aba por nome (workbook.xml -> r:id -> xl/worksheets/sheetN.xml),
# igual ao já usado em Get-NtnbStaticAnchors. Resolve por PADRÃO (-like), não igualdade exata —
# mesmo motivo já documentado pra "Mês Anterior"/"Ano Anterior": o Windows PowerShell 5.1 lê
# este .ps1 (sem BOM) no codepage do sistema, não UTF-8, então um literal acentuado escrito
# aqui (ex: "Preços") chega corrompido em tempo de execução e nunca bateria por igualdade
# contra o nome real extraído do .xlsx (esse sim lido como UTF-8 de verdade via Read-Entry
# abaixo). $SheetNamePattern deve usar só prefixo sem acento (ex: "Pre*" em vez de "Preços*").
# Devolve $null se nenhuma aba bater com o padrão.
function Get-XlsxSheetMap([System.IO.Compression.ZipArchive]$Zip, [string]$SheetNamePattern) {
    function Read-Entry([string]$EntryName) {
        $entry = $Zip.Entries | Where-Object { $_.FullName -eq $EntryName }
        if (-not $entry) { return $null }
        $sr = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
        try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
    }
    $sharedStringsXml = Read-Entry 'xl/sharedStrings.xml'
    $sharedStrings = @()
    if ($sharedStringsXml) {
        $sharedStrings = [regex]::Matches($sharedStringsXml, '<si>(.*?)</si>', 'Singleline') | ForEach-Object {
            ($_.Groups[1].Value -replace '<[^>]+>', '')
        }
    }
    $wbXml = Read-Entry 'xl/workbook.xml'
    $sheetToRid = @{}
    foreach ($m in [regex]::Matches($wbXml, '<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"')) {
        $sheetToRid[$m.Groups[1].Value] = $m.Groups[2].Value
    }
    $relsXml = Read-Entry 'xl/_rels/workbook.xml.rels'
    $ridToTarget = @{}
    foreach ($m in [regex]::Matches($relsXml, '<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"')) {
        $ridToTarget[$m.Groups[1].Value] = $m.Groups[2].Value
    }
    $matchedName = $sheetToRid.Keys | Where-Object { $_ -like $SheetNamePattern } | Select-Object -First 1
    if (-not $matchedName) { return $null }
    $rid = $sheetToRid[$matchedName]
    $sheetXml = Read-Entry "xl/$($ridToTarget[$rid])"
    if (-not $sheetXml) { return $null }
    return ConvertTo-XlsxCellMap $sheetXml $sharedStrings
}

# A planilha organiza os papéis por região/categoria com linhas divisórias (nome na coluna D,
# ISIN vazio) — Brasil, Europa, US Consolidado, Preferred, África/Ásia/Latam, Fundos de Bonds.
# Detecta por essa lista fixa, não por "tem nome sem ISIN" (alguns papéis de verdade também não
# têm ISIN preenchido, ex. "CLN Volkswagen" — continuam ignorados, só não viram seção à toa).
# "África/Ásia/Latam" tem acento — evita literal acentuado (mesmo motivo do comentário em
# Get-XlsxSheetMap) casando só pelo sufixo seguro "*Latam" em vez do texto inteiro.
function Test-BondsSectionDivider([string]$Name) {
    if (-not $Name) { return $false }
    $n = $Name.Trim()
    if (@('Brasil', 'Europa', 'US Consolidado', 'Preferred', 'Fundos de Bonds') -contains $n) { return $true }
    return $n -like '*Latam'
}

# Espelho de handleSnapshot() em api/bonds.js — aba "Controle Duration": Bonds=D, Isin=E,
# Banco=F, Volume=G, Bid Yield=H, Cupom=I (fração), Duration=J, (K vazia), Spread Over
# Treasury=L. Cada linha é uma entrada própria — não agrupa por ISIN (ver comentário em
# api/bonds.js sobre papéis com bancos/dealers diferentes e mesmo ISIN).
function Get-BondsSnapshot([string]$Path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $cellMap = Get-XlsxSheetMap -Zip $zip -SheetNamePattern 'Controle Duration*'
        if (-not $cellMap) { return @() }
        $bonds = [System.Collections.Generic.List[object]]::new()
        $section = $null
        for ($r = 3; $r -le 186; $r++) {
            $name = $cellMap["D$r"]
            $isin = $cellMap["E$r"]
            if ($name -and -not $isin -and (Test-BondsSectionDivider $name)) {
                $section = ([string]$name).Trim()
                continue
            }
            if (-not $name -or -not $isin) { continue }
            $cupom = $cellMap["I$r"]
            $bonds.Add([PSCustomObject]@{
                name = $name; isin = $isin; section = $section; banco = $cellMap["F$r"]
                volumeUsd = $cellMap["G$r"]; bidYield = $cellMap["H$r"]
                cupomPct = if ($null -ne $cupom) { [double]$cupom * 100.0 } else { $null }
                duration = $cellMap["J$r"]; spreadOverTreasury = $cellMap["L$r"]
            })
        }
        return $bonds
    } finally {
        $zip.Dispose()
    }
}

# Espelho de BLOCK_SHEETS/findBlockSeries() em api/bonds.js — as três abas de histórico usam
# o mesmo layout de blocos de 3 colunas (rótulo | valor | vazio) a partir da coluna A, rótulo
# (nome do papel ou vencimento do treasury) na linha 1 alinhado com a coluna de valor — mas
# "Preços" não tem a linha de status entre nome/ticker e sub-cabeçalho, então os dados lá
# começam uma linha antes das outras duas abas.
# SheetPattern usa só prefixo sem acento (ver comentário em Get-XlsxSheetMap) — "Preços" tem
# "ç", por isso o padrão pra "price" é só "Pre*". DisplayName é o nome exibido em mensagens de
# erro; como não dá pra confiar num literal acentuado neste arquivo, "price" usa um nome sem
# acento em vez do nome real da aba.
$BONDS_BLOCK_SHEETS = @{
    yield    = @{ SheetPattern = 'Bid Yield*';         DataStartRow = 5; DisplayName = 'Bid Yield' }
    price    = @{ SheetPattern = 'Pre*';                DataStartRow = 4; DisplayName = 'Precos (aba de preco)' }
    treasury = @{ SheetPattern = 'Treasury*';           DataStartRow = 5; DisplayName = 'Treasury' }
}

function Get-BondsBlockSeries([string]$Path, [string]$Kind, [string]$Label) {
    $cfg = $BONDS_BLOCK_SHEETS[$Kind]
    if (-not $cfg) { return $null }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $cellMap = Get-XlsxSheetMap -Zip $zip -SheetNamePattern $cfg.SheetPattern
        if (-not $cellMap) { return $null }
        $target = $Label.Trim()
        for ($block = 0; $block -lt 90; $block++) {
            $tsCol = 1 + $block * 3
            $valCol = $tsCol + 1
            $tsLetter = ConvertTo-ColLetter $tsCol
            $valLetter = ConvertTo-ColLetter $valCol
            $headerLabel = $cellMap["${valLetter}1"]
            if ($null -eq $headerLabel -or (([string]$headerLabel).Trim()) -ne $target) { continue }

            $series = [System.Collections.Generic.List[object]]::new()
            $lastRow = $cfg.DataStartRow + 1400
            for ($r = $cfg.DataStartRow; $r -le $lastRow; $r++) {
                $dateRaw = $cellMap["${tsLetter}$r"]
                if ($null -eq $dateRaw) { break }
                $val = $cellMap["${valLetter}$r"]
                if ($null -eq $val) { continue }
                $dateStr = if ($dateRaw -is [double]) {
                    ([datetime]::new(1899, 12, 30)).AddDays($dateRaw).ToString('dd/MM/yyyy')
                } else { [string]$dateRaw }
                $series.Add([PSCustomObject]@{ date = $dateStr; value = [double]$val })
            }
            return $series
        }
        return $null
    } finally {
        $zip.Dispose()
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

# ── IA & Chips · helpers (espelho de api/ai-news.js) ─────────────────────────
$AI_JUNK_TITLE_PATTERNS = @(
    'candlestick chart', 'compare against competitors', 'share price today',
    'stock price |', 'stock price history', 'shares outstanding',
    'technical analysis, rsi', 'option chain', 'return on assets',
    'market cap', 'currency converter', 'dividend history', 'earnings per share'
)

$AI_KEYWORDS = @(
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
    'corte de juros', 'interest rate cut', 'rate cut', 'rate cuts', 'alta de juros', 'rate hike',
    'rate hikes',
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
    'Payroll', 'Payrolls', 'nonfarm payrolls', 'jobless claims', 'pedidos de seguro-desemprego',
    'surpresa', 'unexpected', 'surprise',
    'acima do esperado', 'above expectations', 'abaixo do esperado', 'below expectations',
    'recorde', 'record high', 'record low', 'colapso', 'collapse', 'disparada', 'surge',
    'queda acentuada', 'plunge', 'demissão', 'resignation', 'fired', 'renúncia', 'fraude',
    'fraud', 'valuation', 'avaliação', 'earnings', 'receita', 'revenue',
    'EBITDA', 'EPS', 'lucro por ação', 'cash flow', 'fluxo de caixa', 'free cash flow',
    'fluxo de caixa livre', 'debt', 'dívida', 'leverage', 'alavancagem', 'spread', 'yield'
)

$AI_EXCLUDE_KEYWORDS = @(
    'curso', 'course', 'apostila', 'tutorial', 'o que é', 'definition', 'definição',
    'meaning', 'significado', 'vaga', 'job opening', 'career advice', 'concurso público',
    'horóscopo', 'sports', 'esporte', 'football', 'futebol', 'celebrity', 'celebridade',
    'entertainment', 'entretenimento', 'movie', 'filme', 'TV series', 'série', 'gaming',
    'jogo eletrônico', 'product review', 'review', 'promoção', 'discount', 'cupom',
    'coupon', 'sponsored content', 'conteúdo patrocinado', 'advertisement', 'publicidade'
)

# Temas de interesse direto do usuário — espelho de PRIORITY_KEYWORDS em api/ai-news.js. Bônus
# de nota, não filtra nada (diferente de $AI_KEYWORDS).
$AI_PRIORITY_KEYWORDS = @(
    'Fed', 'Federal Reserve', 'FOMC', 'Powell', 'Copom', 'Banco Central', 'Selic', 'Galípolo',
    'BCE', 'ECB', 'Lagarde', 'Bank of Japan', 'BoJ', 'Bank of England', 'BoE', 'corte de juros',
    'alta de juros', 'rate cut', 'rate cuts', 'rate hike', 'rate hikes', 'quantitative easing',
    'quantitative tightening', 'meta de inflação', 'dot plot', 'nonfarm payrolls', 'payroll',
    'payrolls', 'relatório de emprego', 'mercado de trabalho americano', 'jobs report',
    'employment report', 'jobless claims',
    'unemployment rate', 'taxa de desemprego dos EUA',
    'S&P 500', 'Nasdaq', 'Dow Jones', 'Wall Street', 'Magnificent Seven', 'Nvidia', 'Microsoft',
    'Alphabet', 'Google', 'Meta', 'Amazon', 'Apple', 'Broadcom', 'AMD', 'TSMC', 'OpenAI',
    'Anthropic', 'Oracle', 'Palantir', 'CoreWeave', 'earnings season', 'resultados trimestrais',
    'guidance', 'capex de IA',
    'China', 'Taiwan', 'Rússia', 'Russia', 'Ucrânia', 'Ukraine', 'Irã', 'Iran', 'Israel',
    'Oriente Médio', 'Middle East', 'OPEP', 'OPEC', 'tarifas', 'tariffs', 'trade war', 'sanções',
    'sanctions',
    'AMZN', 'MSFT', 'NVDA', 'ASML', 'SMH', 'Danaher', 'DHR', 'Visa', 'Vistra', 'VST', 'GLD', 'GOOGL'
)
$AI_PRIORITY_BONUS = 2

function Get-AiNormalizedText {
    param([string]$Text)
    if (-not $Text) { return '' }
    $formD = $Text.Normalize([System.Text.NormalizationForm]::FormD)
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $formD.ToCharArray()) {
        if ([System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$sb.Append($ch)
        }
    }
    return $sb.ToString().ToLowerInvariant()
}

function Build-AiKeywordPattern {
    param([string[]]$List)
    return ($List | ForEach-Object { Get-AiNormalizedText $_ } | Select-Object -Unique | ForEach-Object { '\b' + [regex]::Escape($_) + '\b' }) -join '|'
}

# Padrões individuais precompilados — usados pra CONTAR quantas palavras-chave batem, não só
# se pelo menos uma bate. Removidos os piores termos ambíguos da lista (ver histórico) e subida
# a exigência pra 3+ termos distintos — reduz mais o ruído do que 2+.
$AI_KEYWORD_REGEXES = [System.Collections.Generic.List[regex]]::new()
foreach ($kw in ($AI_KEYWORDS | ForEach-Object { Get-AiNormalizedText $_ } | Select-Object -Unique)) {
    $AI_KEYWORD_REGEXES.Add([regex]::new('\b' + [regex]::Escape($kw) + '\b'))
}
$AI_EXCLUDE_PATTERN = Build-AiKeywordPattern $AI_EXCLUDE_KEYWORDS
$AI_MIN_KEYWORD_MATCHES = 3
$AI_PRIORITY_PATTERN = Build-AiKeywordPattern $AI_PRIORITY_KEYWORDS

function Test-AiPriorityMatch {
    param([string]$Title, [string]$Summary)
    $text = Get-AiNormalizedText "$Title $Summary"
    return [regex]::IsMatch($text, $AI_PRIORITY_PATTERN)
}

# ── NACIONAL/INTERNACIONAL por assunto, não por veículo — espelho de classifyRegion em
# api/ai-news.js. Um portal brasileiro noticiando o mercado americano cai em INTERNACIONAL,
# não por ter sido publicado no Brasil. Empate/sem sinal cai no critério antigo (fonte).
$AI_BR_REGION_KEYWORDS = @(
    'Brasil', 'Selic', 'Copom', 'Ibovespa', 'IBOV', 'Banco Central do Brasil', 'Lula', 'Bolsonaro',
    'Congresso Nacional', 'Câmara dos Deputados', 'Senado Federal', 'STF', 'Supremo Tribunal Federal',
    'Brasília', 'IPCA', 'IGP-M', 'Petrobras', 'Itaú', 'Bradesco', 'Banco do Brasil', 'B3',
    'Receita Federal', 'governo Lula', 'Haddad', 'Galípolo', 'real brasileiro', 'PIB brasileiro',
    'TSE', 'eleições municipais', 'eleições presidenciais no Brasil'
)
$AI_INTL_REGION_KEYWORDS = @(
    'Estados Unidos', 'EUA', 'United States', 'Fed', 'Federal Reserve', 'FOMC', 'Powell',
    'Wall Street', 'S&P 500', 'Nasdaq', 'Dow Jones', 'China', 'União Europeia', 'European Union',
    'BCE', 'ECB', 'Rússia', 'Russia', 'Ucrânia', 'Ukraine', 'Taiwan', 'Israel', 'Irã', 'Iran',
    'Oriente Médio', 'Middle East', 'OPEP', 'OPEC', 'Reino Unido', 'United Kingdom',
    'Bank of England', 'Japão', 'Bank of Japan', 'Coreia do Norte', 'North Korea', 'Nvidia',
    'Apple', 'Microsoft', 'Amazon', 'Google', 'Alphabet', 'Meta', 'OpenAI', 'Anthropic', 'Trump',
    'Casa Branca', 'White House', 'Bruxelas', 'Londres', 'Pequim', 'Moscou', 'Tóquio'
)
$AI_BR_REGION_REGEXES = [System.Collections.Generic.List[regex]]::new()
foreach ($kw in ($AI_BR_REGION_KEYWORDS | ForEach-Object { Get-AiNormalizedText $_ } | Select-Object -Unique)) {
    $AI_BR_REGION_REGEXES.Add([regex]::new('\b' + [regex]::Escape($kw) + '\b'))
}
$AI_INTL_REGION_REGEXES = [System.Collections.Generic.List[regex]]::new()
foreach ($kw in ($AI_INTL_REGION_KEYWORDS | ForEach-Object { Get-AiNormalizedText $_ } | Select-Object -Unique)) {
    $AI_INTL_REGION_REGEXES.Add([regex]::new('\b' + [regex]::Escape($kw) + '\b'))
}

function Get-AiRegionMatchCount {
    param([System.Collections.Generic.List[regex]]$Patterns, [string]$Text)
    $count = 0
    foreach ($re in $Patterns) { if ($re.IsMatch($Text)) { $count++ } }
    return $count
}

function Get-AiClassifiedRegion {
    param([string]$Title, [string]$Summary, [string]$SourceRegion)
    $text = Get-AiNormalizedText "$Title $Summary"
    $brHits = Get-AiRegionMatchCount $AI_BR_REGION_REGEXES $text
    $intlHits = Get-AiRegionMatchCount $AI_INTL_REGION_REGEXES $text
    if ($brHits -gt $intlHits) { return 'nacional' }
    if ($intlHits -gt $brHits) { return 'internacional' }
    return $SourceRegion
}

function Get-AiKeywordMatchCount {
    param([string]$Text)
    $count = 0
    foreach ($re in $AI_KEYWORD_REGEXES) {
        if ($re.IsMatch($Text)) { $count++ }
    }
    return $count
}

function Test-AiKeywordMatch {
    param([string]$Title, [string]$Summary)
    $text = Get-AiNormalizedText "$Title $Summary"
    if ([regex]::IsMatch($text, $AI_EXCLUDE_PATTERN)) { return $false }
    return (Get-AiKeywordMatchCount $text) -ge $AI_MIN_KEYWORD_MATCHES
}

# ── Nota de relevância (1-10) — espelho de assignRelevance em api/ai-news.js ─────────────────
$AI_TOP_PICK_MIN_SCORE = 6
$AI_OUTLET_WEIGHT = @{ nacional = 1.5; internacional = 2 }
# $AI_SOURCE_REGION é populado mais abaixo, depois que Get-AiNewsSourcesConfig existe (ordem de
# definição das funções no script).
$AI_SOURCE_REGION = @{}

# Duas manchetes sobre a MESMA notícia raramente têm escrita parecida — um Jaccard simples de
# palavras subestima isso (a palavra que identifica a história, ex: "BP", é curta e as que
# sobram em comum tendem a ser genéricas, tipo "oil"/"war", comuns em várias matérias do
# mesmo ciclo). Peso tipo TF-IDF: cada palavra pesa pelo inverso de quantas matérias a contêm.
$AI_STOPWORDS = [System.Collections.Generic.HashSet[string]]::new([string[]]@(
    'para', 'como', 'mais', 'sobre', 'entre', 'depois', 'antes', 'contra', 'diz', 'disse',
    'apos', 'nesta', 'neste', 'pode', 'deve', 'ainda', 'tambem', 'quando', 'onde', 'uma', 'um',
    'dos', 'das', 'dia', 'ser', 'ter', 'foi', 'sao', 'com', 'por', 'que', 'nao',
    'with', 'from', 'that', 'this', 'have', 'says', 'after', 'before', 'about', 'their',
    'will', 'what', 'which', 'into', 'over', 'amid', 'the', 'and', 'for', 'are', 'was', 'were',
    'has', 'had', 'not', 'its', 'his', 'her', 'you', 'but', 'all', 'can', 'new'
))
$AI_MIN_WORD_LEN = 2
$AI_CLUSTER_SIMILARITY = 0.22
$AI_CLUSTER_MAX_TIME_GAP = 48 * 3600

function Get-AiTitleWordSet {
    param([string]$Title)
    $norm = (Get-AiNormalizedText $Title) -replace '[^a-z0-9\s]', ' '
    $set = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($w in ($norm -split '\s+')) {
        if ($w.Length -ge $AI_MIN_WORD_LEN -and -not $AI_STOPWORDS.Contains($w)) { [void]$set.Add($w) }
    }
    return $set
}

function Get-AiIdf {
    param([object[]]$WordSets)
    $df = @{}
    foreach ($set in $WordSets) { foreach ($w in $set) { $df[$w] = ($df[$w] + 1) } }
    $n = $WordSets.Count
    $idf = @{}
    foreach ($w in $df.Keys) { $idf[$w] = [Math]::Log(($n + 1) / ($df[$w] + 1)) + 1 }
    return $idf
}

function Get-AiWeightedSimilarity {
    param($A, $B, $Idf)
    $inter = 0.0; $normA = 0.0; $normB = 0.0
    foreach ($w in $A) { $wt = if ($Idf.ContainsKey($w)) { $Idf[$w] } else { 1 }; $normA += $wt * $wt; if ($B.Contains($w)) { $inter += $wt } }
    foreach ($w in $B) { $wt = if ($Idf.ContainsKey($w)) { $Idf[$w] } else { 1 }; $normB += $wt * $wt }
    $denom = [Math]::Sqrt($normA) * [Math]::Sqrt($normB)
    if ($denom -eq 0) { return 0 }
    return $inter / $denom
}

# Cluster por similaridade de título entre fontes diferentes (mesma história, manchetes
# distintas). $Items é uma lista de PSCustomObject com Source/Title/Headline; anota
# RelevanceScore e TopPick em cada item.
function Set-AiRelevance {
    param([object[]]$Items)
    if (-not $Items -or $Items.Count -eq 0) { return }
    # NÃO usar "@($Items | ForEach-Object { Get-AiTitleWordSet ... })" aqui — o pipeline do
    # PowerShell desenrola automaticamente o HashSet retornado por cada chamada, misturando as
    # palavras de TODAS as manchetes numa lista só em vez de manter um HashSet por item (bug
    # real, silencioso, já encontrado e corrigido nessa sessão). Loop explícito com .Add()
    # evita esse desenrolamento.
    $wordSets = [System.Collections.Generic.List[object]]::new()
    foreach ($it in $Items) { $wordSets.Add((Get-AiTitleWordSet $it.title)) }
    $idf = Get-AiIdf $wordSets
    for ($i = 0; $i -lt $Items.Count; $i++) {
        $outlets = [System.Collections.Generic.HashSet[string]]::new()
        [void]$outlets.Add($Items[$i].source)
        for ($j = 0; $j -lt $Items.Count; $j++) {
            if ($j -eq $i -or $Items[$j].source -eq $Items[$i].source) { continue }
            $gap = if ($Items[$i].time -and $Items[$j].time) { [Math]::Abs($Items[$i].time - $Items[$j].time) } else { 0 }
            if ($gap -gt $AI_CLUSTER_MAX_TIME_GAP) { continue }
            if ((Get-AiWeightedSimilarity $wordSets[$i] $wordSets[$j] $idf) -ge $AI_CLUSTER_SIMILARITY) { [void]$outlets.Add($Items[$j].source) }
        }
        $multiOutletScore = 0.0
        foreach ($outlet in $outlets) {
            $region = $AI_SOURCE_REGION[$outlet]
            $multiOutletScore += if ($AI_OUTLET_WEIGHT.ContainsKey($region)) { $AI_OUTLET_WEIGHT[$region] } else { 2 }
        }
        # [Math]::Min(5, $x) com "5" sem ponto decimal escolhe a sobrecarga Math.Min(Int32,Int32)
        # e ARREDONDA $x pra int antes de comparar (bug real encontrado e corrigido nessa
        # sessão — 1.5 virava 2 silenciosamente). "5.0" força a sobrecarga Math.Min(Double,Double).
        $multiOutletScore = [Math]::Min(5.0, $multiOutletScore)
        $headlineScore = if ($Items[$i].headline) { 5 } else { 1 }
        $priorityBonus = if (Test-AiPriorityMatch $Items[$i].title $Items[$i].summary) { $AI_PRIORITY_BONUS } else { 0 }
        $score = [Math]::Min(10.0, [Math]::Round($multiOutletScore + $headlineScore + $priorityBonus, 1))
        Add-Member -InputObject $Items[$i] -NotePropertyName relevanceScore -NotePropertyValue $score -Force
        Add-Member -InputObject $Items[$i] -NotePropertyName topPick -NotePropertyValue ($score -ge $AI_TOP_PICK_MIN_SCORE) -Force
        $Items[$i].PSObject.Properties.Remove('headline')
    }
}

function Test-AiJunkTitle {
    param([string]$Title)
    $lower = $Title.ToLowerInvariant()
    foreach ($p in $AI_JUNK_TITLE_PATTERNS) { if ($lower.Contains($p)) { return $true } }
    return $false
}

function Test-AiMeaningfulTitle {
    param([string]$Title, [string]$Source)
    if (-not $Title) { return $false }
    $remaining = $Title.ToLowerInvariant().Replace($Source.ToLowerInvariant(), '').Trim(" -|,".ToCharArray())
    return $remaining.Length -ge 10
}

function Get-AiCleanText {
    param([string]$Raw)
    if (-not $Raw) { return '' }
    $text = ConvertFrom-HtmlEntities ($Raw -replace '<[^>]+>', '')
    $text = ($text -replace '\s+', ' ').Trim()
    $text = $text -replace '\s*The post .*? appeared first on .*?\.\s*$', ''
    return $text
}

function Get-AiCleanTitle {
    param([string]$Title, [string]$Source)
    $t = $Title
    if ($t.Contains(' - ')) {
        $idx = $t.LastIndexOf(' - ')
        $head = $t.Substring(0, $idx)
        $tail = $t.Substring($idx + 3)
        if ($tail.ToLowerInvariant().Contains($Source.ToLowerInvariant())) { $t = $head }
    }
    $bySuffix = " by $Source".ToLowerInvariant()
    if ($t.ToLowerInvariant().EndsWith($bySuffix)) { $t = $t.Substring(0, $t.Length - $bySuffix.Length) }
    $t = $t.Trim()
    if ($t.StartsWith('- ')) { $t = $t.Substring(2).Trim() }
    return $t
}

function Get-AiPagedUrl {
    param([string]$Url, [int]$Page)
    if ($Page -le 1) { return $Url }
    $sep = if ($Url.Contains('?')) { '&' } else { '?' }
    return "$Url${sep}paged=$Page"
}

# Homepage de cada fonte, espelho de SOURCE_HOMEPAGES em api/ai-news.js — Reuters fica de
# fora (sem homepage própria checável, só o proxy Google News).
function Get-AiSourceHomepages {
    return @{
        # 'G1' = 'https://g1.globo.com/' # G1 removido do terminal (2026-08-05).
        'CNBC' = 'https://www.cnbc.com/world/'
        'Brazil Journal' = 'https://braziljournal.com/'
        'InfoMoney' = 'https://www.infomoney.com.br/'
        'Investing.com' = 'https://www.investing.com/'
        'NeoFeed' = 'https://neofeed.com.br/'
        'Poder360' = 'https://www.poder360.com.br/'
        'BBC' = 'https://www.bbc.com/'
        'Valor' = 'https://valor.globo.com/'
        'Yahoo Finance' = 'https://finance.yahoo.com/'
        # WSJ e Bloomberg ficam de fora — wsj.com devolve 401 pra fetch simples (paywall na
        # borda) e bloomberg.com devolve 403 (bloqueio de bot). Caem pro proxy antigo de
        # "manchete" (top 3 do feed).
    }
}

function Get-AiUrlPath {
    param([string]$Url, [string]$BaseUrl)
    try {
        $u = [Uri]::new([Uri]$BaseUrl, $Url)
        return $u.AbsolutePath.TrimEnd('/').ToLowerInvariant()
    } catch {
        return $Url
    }
}

# Baixa a homepage de uma fonte e extrai o conjunto de caminhos linkados nela — espelho de
# fetchHomepagePaths em api/ai-news.js.
function Get-AiHomepagePaths {
    param([string]$BaseUrl)
    $wc = [System.Net.WebClient]::new()
    $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
    $wc.Encoding = [System.Text.Encoding]::UTF8
    $html = $wc.DownloadString($BaseUrl)
    $paths = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($m in [regex]::Matches($html, '<a[^>]+href=["'']([^"'']+)["'']', 'IgnoreCase')) {
        [void]$paths.Add((Get-AiUrlPath $m.Groups[1].Value $BaseUrl))
    }
    return $paths
}

function Get-AiNewsSourcesConfig {
    return @(
        # G1 removido do terminal a pedido do usuário (2026-08-05) — descomentar pra reativar.
        # @{ name = 'G1'; region = 'nacional'; pages = 1; urls = @(
        #     'https://g1.globo.com/rss/g1/economia/',
        #     'https://g1.globo.com/rss/g1/politica/'
        # ) },
        @{ name = 'CNBC'; region = 'internacional'; pages = 1; urls = @(
            'https://www.cnbc.com/id/100727362/device/rss/rss.html',
            'https://www.cnbc.com/id/100003114/device/rss/rss.html',
            'https://www.cnbc.com/id/10001147/device/rss/rss.html',
            'https://www.cnbc.com/id/20910258/device/rss/rss.html',
            'https://www.cnbc.com/id/15839069/device/rss/rss.html'
        ) },
        @{ name = 'Reuters'; region = 'internacional'; pages = 1; urls = @('https://news.google.com/rss/search?q=site:reuters.com+when:2d&hl=en-US&gl=US&ceid=US:en') },
        @{ name = 'Brazil Journal'; region = 'nacional'; pages = 4; urls = @('https://braziljournal.com/feed/') },
        @{ name = 'InfoMoney'; region = 'nacional'; pages = 5; urls = @('https://www.infomoney.com.br/feed/') },
        @{ name = 'Investing.com'; region = 'internacional'; pages = 1; urls = @(
            'https://www.investing.com/rss/news.rss',
            'https://www.investing.com/rss/news_25.rss',
            'https://www.investing.com/rss/news_301.rss',
            'https://www.investing.com/rss/market_overview.rss',
            'https://www.investing.com/rss/news_1.rss',
            'https://www.investing.com/rss/commodities.rss'
        ) },
        @{ name = 'NeoFeed'; region = 'nacional'; pages = 1; urls = @('https://neofeed.com.br/feed/') },
        @{ name = 'Poder360'; region = 'nacional'; pages = 1; urls = @('https://www.poder360.com.br/feed/') },
        @{ name = 'BBC'; region = 'internacional'; pages = 1; urls = @(
            'https://feeds.bbci.co.uk/news/world/rss.xml',
            'https://feeds.bbci.co.uk/news/business/rss.xml'
        ) },
        @{ name = 'Valor'; region = 'nacional'; pages = 1; urls = @('https://valor.globo.com/rss/valor/') },
        @{ name = 'WSJ'; region = 'internacional'; pages = 1; urls = @('https://news.google.com/rss/search?q=site:wsj.com+when:2d&hl=en-US&gl=US&ceid=US:en') },
        @{ name = 'Bloomberg'; region = 'internacional'; pages = 1; urls = @('https://news.google.com/rss/search?q=site:bloomberg.com+when:2d&hl=en-US&gl=US&ceid=US:en') },
        @{ name = 'Yahoo Finance'; region = 'internacional'; pages = 1; urls = @('https://finance.yahoo.com/news/rssindex') }
    )
}

foreach ($s in (Get-AiNewsSourcesConfig)) { $AI_SOURCE_REGION[$s.name] = $s.region }

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
    # Fundido com o antigo /api/summarize-news nessa sessão (Hobby limita a 12 Serverless
    # Functions por deployment — ver METODOLOGIA.md seção 19.1.1). ?action=summarize aciona
    # o resumo por IA; sem esse parâmetro, comportamento de sempre (lista de notícias).
    if ($path -eq '/api/news' -and $req.QueryString['action'] -ne 'summarize') {
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

    # ── IA & Chips · agregador temático (espelho de api/ai-news.js) ──────────
    if ($path -eq '/api/ai-news') {
        try {
            $sources = Get-AiNewsSourcesConfig
            $windowCutoff = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - (72 * 3600)
            $allItems = @()
            $errors = @()

            $homepagePaths = @{}
            foreach ($hp in (Get-AiSourceHomepages).GetEnumerator()) {
                try { $homepagePaths[$hp.Key] = Get-AiHomepagePaths $hp.Value }
                catch { $homepagePaths[$hp.Key] = $null } # cai pro proxy antigo (top 3 do feed)
            }

            foreach ($source in $sources) {
                $seenLinks = New-Object System.Collections.Generic.HashSet[string]
                $seenTitles = New-Object System.Collections.Generic.HashSet[string]
                $sourceHadError = $false
                foreach ($baseUrl in $source.urls) {
                    for ($page = 1; $page -le $source.pages; $page++) {
                        $url = Get-AiPagedUrl $baseUrl $page
                        try {
                            $wc = [System.Net.WebClient]::new()
                            $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
                            $wc.Encoding = [System.Text.Encoding]::UTF8
                            $xml = $wc.DownloadString($url)
                        } catch {
                            if ($page -eq 1) { $errors += "$($source.name): $($_.Exception.Message)"; $sourceHadError = $true }
                            continue
                        }
                        $blocks = [regex]::Matches($xml, '<item>[\s\S]*?</item>')
                        $rank = -1
                        foreach ($b in $blocks) {
                            $rank++
                            $block = $b.Value
                            $rawTitle = Get-XmlTag $block 'title'
                            $link = Get-XmlTag $block 'link'
                            $rawDesc = Get-XmlTag $block 'description'
                            $pubDate = Get-XmlTag $block 'pubDate'
                            if (-not $rawTitle -or -not $link) { continue }
                            if ($seenLinks.Contains($link)) { continue }

                            $title = Get-AiCleanTitle (Get-AiCleanText $rawTitle) $source.name
                            if (-not (Test-AiMeaningfulTitle $title $source.name)) { continue }
                            if (Test-AiJunkTitle $title) { continue }
                            $titleKey = $title.ToLowerInvariant()
                            if ($seenTitles.Contains($titleKey)) { continue }
                            [void]$seenTitles.Add($titleKey)
                            [void]$seenLinks.Add($link)

                            $summary = Get-AiCleanText $rawDesc
                            if ($summary.StartsWith($title)) { $summary = $summary.Substring($title.Length).Trim() }
                            if ($summary.Length -le ($source.name.Length + 2)) { $summary = '' }

                            if (-not (Test-AiKeywordMatch $title $summary)) { continue }

                            $time = $null
                            try { $time = [int64][double]([DateTimeOffset]::Parse($pubDate)).ToUnixTimeSeconds() } catch {}
                            if ($time -and $time -lt $windowCutoff) { continue }

                            $hpSet = $homepagePaths[$source.name]
                            $headline = if ($hpSet) { $hpSet.Contains((Get-AiUrlPath $link $baseUrl)) } else { ($page -eq 1 -and $rank -lt 3) }
                            $region = Get-AiClassifiedRegion $title $summary $source.region

                            $allItems += [PSCustomObject]@{
                                source = $source.name; region = $region; title = $title
                                link = $link; publisher = $source.name; summary = $summary; time = $time
                                headline = $headline
                            }
                        }
                    }
                }
            }

            Set-AiRelevance $allItems
            $allItems = $allItems | Sort-Object -Property @{Expression = { $_.time }; Descending = $true}
            $nacional = @($allItems | Where-Object { $_.region -eq 'nacional' })
            $internacional = @($allItems | Where-Object { $_.region -eq 'internacional' })

            $result = @{ nacional = $nacional; internacional = $internacional; errors = $errors } | ConvertTo-Json -Depth 8
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
    if ($path -eq '/api/news' -and $req.QueryString['action'] -eq 'summarize') {
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
            $rawJson = $wc.DownloadString($yUrl)
            $obj = $rawJson | ConvertFrom-Json
            $meta = $obj.chart.result[0].meta
            if ($meta -and ($null -eq $meta.regularMarketPreviousClose) -and ($null -eq $meta.previousClose)) {
                try {
                    $prev = Get-YahooOfficialPreviousClose $ticker
                    Add-Member -InputObject $meta -NotePropertyName regularMarketPreviousClose -NotePropertyValue $prev -Force
                } catch {} # sem sorte no fallback — o front-end ainda tem o heurística sobre o gráfico
            }
            $body = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 15))
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

    # ── Proxy B3 DI Futuro (com fallback pro TradingView se a B3 estiver fora do ar) ──
    if ($path -eq '/api/b3' -and -not $req.QueryString['history']) {
        $symbol = if ($req.QueryString['s']) { $req.QueryString['s'] } else { 'DI1F30' }
        $b3Url = "https://cotacao.b3.com.br/mds/api/v1/InstrumentQuotation/$([Uri]::EscapeDataString($symbol))"
        $result = $null
        $b3ErrMsg = $null
        try {
            $wc = [System.Net.WebClient]::new()
            $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
            $wc.Headers.Add('Accept', 'application/json')
            $raw = $wc.DownloadString($b3Url)
            $data = $raw | ConvertFrom-Json
            if ($data.BizSts.cd -ne 'OK' -or -not $data.Trad) { throw "sem negócios" }
            $qtn = $data.Trad[0].scty.SctyQtn
            $result = "{`"price`":$($qtn.curPrc),`"open`":$($qtn.opngPric),`"date`":`"$($data.Msg.dtTm)`",`"source`":`"b3`"}"
        } catch {
            $b3ErrMsg = $_.Exception.Message
        }
        if (-not $result) {
            # Fallback: scanner do TradingView (não-oficial, mas estável — funciona até do
            # PowerShell, diferente do ADVFN que a Cloudflare bloqueava por fingerprint de TLS).
            # Endpoint certo é /global/scan — /brazil/scan só cobre ações, devolve vazio pra
            # futuros. Símbolo usa ano com 4 dígitos (DI1F2030 em vez de DI1F30).
            try {
                $tvSymbol = $symbol -replace '(\d{2})$', '20$1'
                $tvBody = @{
                    symbols = @{ tickers = @("BMFBOVESPA:$tvSymbol"); query = @{ types = @('futures') } }
                    columns = @('close', 'open')
                } | ConvertTo-Json -Depth 5 -Compress
                $wc2 = [System.Net.WebClient]::new()
                $wc2.Headers.Add('Content-Type', 'application/json')
                $wc2.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
                $wc2.Encoding = [System.Text.Encoding]::UTF8
                $raw2 = $wc2.UploadString('https://scanner.tradingview.com/global/scan', 'POST', $tvBody)
                $tvData = $raw2 | ConvertFrom-Json
                $row = $tvData.data[0].d
                if (-not $row -or $null -eq $row[0]) { throw "símbolo $tvSymbol não encontrado" }
                $price = $row[0]
                $open = if ($row.Count -gt 1 -and $null -ne $row[1]) { $row[1] } else { 'null' }
                $result = "{`"price`":$price,`"open`":$open,`"date`":null,`"source`":`"tradingview`"}"
            } catch {
                $tvErrMsg = $_.Exception.Message
                $safeB3 = ($b3ErrMsg -replace '"', '\"') -replace "`n", ' '
                $safeTv = ($tvErrMsg -replace '"', '\"') -replace "`n", ' '
                $result = "{`"error`":`"B3: $safeB3 · TradingView: $safeTv`"}"
            }
        }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
        $res.ContentType = 'application/json; charset=utf-8'
        $res.Headers.Add('Access-Control-Allow-Origin', '*')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
        continue
    }

    # ── Histórico diário do DI Futuro via WebSocket do TradingView (fundido em /api/b3) ──
    # Mesmo protocolo usado em api/b3.js (ver comentário lá pro detalhamento) — aqui usando
    # System.Net.WebSockets.ClientWebSocket (.NET Framework 4.5+) em vez do pacote `ws` do
    # Node. Fundido com a rota de cotação nessa sessão (Hobby limita a 12 Serverless
    # Functions por deployment — ver METODOLOGIA.md seção 19.1.1); `?s=X&history=1` aciona
    # esse ramo em vez da cotação atual. Importante: ReceiveAsync pode devolver uma mensagem
    # em vários pedaços (fragmentos) — só trata como completa quando `EndOfMessage` vem
    # `true`, acumulando num StringBuilder até lá. Sem isso, mensagens maiores (como o
    # timescale_update com 500 barras) chegavam cortadas e o parser silenciosamente
    # descartava o resto, nunca completando (bug real encontrado e corrigido testando).
    if ($path -eq '/api/b3' -and $req.QueryString['history']) {
        try {
            $symbol = $req.QueryString['s']
            if (-not $symbol -or $symbol -notmatch '^DI1F\d{2}$') { throw "symbol inválido (esperado ex: DI1F30)" }
            $tvSymbol = 'BMFBOVESPA:' + ($symbol -replace '(\d{2})$', '20$1')

            $client = [System.Net.WebSockets.ClientWebSocket]::new()
            $client.Options.SetRequestHeader('Origin', 'https://www.tradingview.com')
            $cts = [System.Threading.CancellationTokenSource]::new(8000)
            $client.ConnectAsync([Uri]::new('wss://data.tradingview.com/socket.io/websocket'), $cts.Token).GetAwaiter().GetResult() | Out-Null

            function Send-TvMsg($ws, $method, $paramsJson, $token) {
                $payload = "{`"m`":`"$method`",`"p`":$paramsJson}"
                $msg = "~m~$($payload.Length)~m~$payload"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
                $ws.SendAsync([System.ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $token).GetAwaiter().GetResult() | Out-Null
            }

            $chartSession = 'cs_' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
            Send-TvMsg $client 'set_auth_token' '["unauthorized_user_token"]' $cts.Token
            Send-TvMsg $client 'chart_create_session' "[`"$chartSession`",`"`"]" $cts.Token
            $symbolInit = "={`"symbol`":`"$tvSymbol`",`"adjustment`":`"splits`"}"
            $symbolInitEscaped = $symbolInit -replace '"', '\"'
            Send-TvMsg $client 'resolve_symbol' "[`"$chartSession`",`"symbol_1`",`"$symbolInitEscaped`"]" $cts.Token
            Send-TvMsg $client 'create_series' "[`"$chartSession`",`"series_1`",`"s1`",`"symbol_1`",`"1D`",500]" $cts.Token

            $history = $null
            $buffer = New-Object byte[] 131072
            $msgBuilder = [System.Text.StringBuilder]::new()
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            while ($sw.ElapsedMilliseconds -lt 8000 -and -not $history) {
                $recvResult = $client.ReceiveAsync([System.ArraySegment[byte]]::new($buffer), $cts.Token).GetAwaiter().GetResult()
                [void]$msgBuilder.Append([System.Text.Encoding]::UTF8.GetString($buffer, 0, $recvResult.Count))
                if (-not $recvResult.EndOfMessage) { continue }
                $raw = $msgBuilder.ToString()
                [void]$msgBuilder.Clear()
                $i = 0
                while ($i -lt $raw.Length -and $raw.Substring($i).StartsWith('~m~')) {
                    $sepIdx = $raw.IndexOf('~m~', $i + 3)
                    if ($sepIdx -lt 0) { break }
                    $len = [int]$raw.Substring($i + 3, $sepIdx - ($i + 3))
                    $start = $sepIdx + 3
                    if ($start + $len -gt $raw.Length) { break }
                    $frame = $raw.Substring($start, $len)
                    $i = $start + $len
                    if ($frame.StartsWith('~h~')) {
                        $echo = [System.Text.Encoding]::UTF8.GetBytes("~m~$($frame.Length)~m~$frame")
                        $client.SendAsync([System.ArraySegment[byte]]::new($echo), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult() | Out-Null
                        continue
                    }
                    try { $obj = $frame | ConvertFrom-Json } catch { continue }
                    if ($obj.m -eq 'timescale_update' -and $obj.p[1].series_1.s) {
                        $history = $obj.p[1].series_1.s | ForEach-Object {
                            [PSCustomObject]@{ date = [int64]$_.v[0]; value = $_.v[4] }
                        }
                    } elseif ($obj.m -in @('symbol_error', 'series_error', 'critical_error')) {
                        throw "TradingView: $($obj.m)"
                    }
                }
            }
            $client.Dispose()
            if (-not $history) { throw "timeout aguardando dados do TradingView" }
            $result = @{ history = $history; source = 'tradingview' } | ConvertTo-Json -Depth 6
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $errMsg = ($_.Exception.Message -replace '"', '\"') -replace "`n", ' '
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
            $res.StatusCode = 500
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $err.Length
            $res.OutputStream.Write($err, 0, $err.Length)
        }
        $res.OutputStream.Close()
        continue
    }

    # ── Proxy planilha estática NTN-B (relatório de Fechamento, ?staticAnchors=) ────────────
    # Espelho de handleStaticAnchors em api/ntnb.js — precisa vir ANTES dos outros blocos de
    # /api/ntnb abaixo.
    if ($path -eq '/api/ntnb' -and $req.QueryString['staticAnchors']) {
        try {
            $xlsxPath = Join-Path $root 'Taxas Antigas NTNB.xlsx'
            $found = Get-NtnbStaticAnchors -Path $xlsxPath
            if ($found) {
                $result = "{`"month`":$(ConvertTo-NtnbAnchorJson $found.month),`"year`":$(ConvertTo-NtnbAnchorJson $found.year)}"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
                $res.ContentType = 'application/json'
                $res.Headers.Add('Access-Control-Allow-Origin', '*')
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $err = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Taxas Antigas NTNB.xlsx: sem dados"}')
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

    # ── Proxy ANBIMA NTN-B · datas específicas (relatório de Fechamento, ?dates=) ──────────
    # Espelho do modo multi-data de api/ntnb.js — precisa vir ANTES do bloco de snapshot
    # abaixo, senão uma requisição com ?dates= (sem ?days=) cairia lá por engano.
    if ($path -eq '/api/ntnb' -and $req.QueryString['dates']) {
        try {
            $requested = $req.QueryString['dates'] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
            $items = [System.Collections.Generic.List[string]]::new()
            foreach ($dt in $requested) {
                $found = Get-NtnbNear -DateStr $dt
                if ($found) {
                    $ratesJson = ($found.rates.GetEnumerator() | ForEach-Object { "`"$($_.Key)`":$($_.Value)" }) -join ','
                    $items.Add("{`"date`":`"$($found.date)`",`"rates`":{$ratesJson}}")
                } else {
                    $items.Add('null')
                }
            }
            $result = "{`"results`":[$($items -join ',')]}"
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

    # ── Proxy ANBIMA NTN-B (fundido com /api/ntnb-history nessa sessão — Hobby limita a 12
    # Serverless Functions por deployment, ver METODOLOGIA.md seção 19.1.1) ───────────────
    if ($path -eq '/api/ntnb' -and -not $req.QueryString['days']) {
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

    # ── Proxy ANBIMA NTN-B · histórico (fundido em /api/ntnb — ?days=N aciona esse ramo) ──
    if ($path -eq '/api/ntnb' -and $req.QueryString['days']) {
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
    # Espelho do handler em api/anbima.js — snapshot do dia mais recente.
    if ($path -eq '/api/anbima') {
        try {
            $dates = Get-BusinessDaysBack -StartDate (Get-Date) -Count 5
            $found = $null
            foreach ($dt in $dates) {
                $found = Get-EttjOneDay -Dt $dt
                if ($found) { break }
            }

            if ($found) {
                $result = "{`"ettjIpca`":$($found.ettjIpca),`"ettjPre`":$($found.ettjPre),`"infImpl`":$($found.infImpl),`"date`":`"$($found.date)`"}"
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

    # ── Proxy planilha Bonds Terminal.xlsx ──────────────────────────────────
    # Espelho de api/bonds.js — sem ?history, devolve o snapshot da aba "Controle Duration";
    # ?history=yield|price&name=... ou ?history=treasury&maturity=..., devolve a série da aba
    # correspondente (ver $BONDS_BLOCK_SHEETS).
    if ($path -eq '/api/bonds') {
        try {
            $xlsxPath = Join-Path $root 'Bonds Terminal.xlsx'
            $kind = $req.QueryString['history']
            if ($kind -eq 'yield' -or $kind -eq 'price') {
                $name = $req.QueryString['name']
                if (-not $name) { throw 'parâmetro "name" obrigatório' }
                $series = Get-BondsBlockSeries -Path $xlsxPath -Kind $kind -Label $name
                if ($null -eq $series) {
                    $result = @{ history = @(); warning = "nao encontrado na aba $($BONDS_BLOCK_SHEETS[$kind].DisplayName)" } | ConvertTo-Json -Depth 4
                } else {
                    $result = @{ history = @($series) } | ConvertTo-Json -Depth 4
                }
            } elseif ($kind -eq 'treasury') {
                $maturity = $req.QueryString['maturity']
                if (-not $maturity) { throw 'parâmetro "maturity" obrigatório' }
                $series = Get-BondsBlockSeries -Path $xlsxPath -Kind 'treasury' -Label $maturity
                if ($null -eq $series) {
                    $result = @{ history = @(); warning = 'não encontrado na aba "Treasury"' } | ConvertTo-Json -Depth 4
                } else {
                    $result = @{ history = @($series) } | ConvertTo-Json -Depth 4
                }
            } elseif ($kind) {
                throw 'history deve ser "yield", "price" ou "treasury"'
            } else {
                $bonds = Get-BondsSnapshot -Path $xlsxPath
                $result = @{ bonds = @($bonds) } | ConvertTo-Json -Depth 4
            }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $errMsg = "Bonds Terminal.xlsx: $($_.Exception.Message)" -replace '\\', '\\\\' -replace '"', '\"'
            $err = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
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
