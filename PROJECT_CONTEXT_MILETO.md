Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$outFile = Join-Path (Get-Location) "PROJECT_CONTEXT_MILETO.md"

# Zera o arquivo
Remove-Item $outFile -Force -ErrorAction SilentlyContinue
New-Item -ItemType File -Path $outFile -Force | Out-Null

function Get-CleanFromClipboard {
  $raw = Get-Clipboard -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

  $lines = $raw -split "`r?`n"
  $clean = New-Object System.Collections.Generic.List[string]

  foreach ($l in $lines) {
    if ($l -match '^---PART \d+/\d+ BEGIN---$') { continue }
    if ($l -match '^---PART \d+/\d+ END---$') { continue }
    if ($l -match '^\[PART_LEN\]=') { continue }
    if ($l -match '^\[PART_SHA256\]=') { continue }
    $clean.Add($l)
  }

  $text = ($clean -join "`n").Trim()
  if ($text.Length -lt 200) { return $null }  # evita clipboard errado
  return $text + "`n"
}

for ($i = 1; $i -le 6; $i++) {
  while ($true) {
    Write-Host ""
    Write-Host "PASSO $i/6: Copie o PART $i (inteiro) do chat para o clipboard e pressione ENTER..." -ForegroundColor Cyan
    Read-Host | Out-Null

    $part = Get-CleanFromClipboard
    if ($null -ne $part) {
      Add-Content -Path $outFile -Value $part -Encoding utf8
      $len = (Get-Item $outFile).Length
      Write-Host "OK: PART $i/6 gravado. Tamanho atual: $len bytes." -ForegroundColor Green
      break
    } else {
      Write-Host "Clipboard vazio/pequeno (provável cópia errada). Copie o PART $i novamente e tente de novo." -ForegroundColor Yellow
    }
  }
}

$final = (Get-Item $outFile).Length
Write-Host ""
Write-Host "FINAL: Arquivo criado -> $outFile" -ForegroundColor Green
Write-Host "Tamanho final: $final bytes" -ForegroundColor Green

if ($final -lt 8000) {
  Write-Host "ATENÇÃO: ficou pequeno demais. Alguma PART veio errada (ou não foi copiada inteira)." -ForegroundColor Red
}

Write-Host ""
Write-Host "Preview (primeiras 30 linhas):" -ForegroundColor Gray
Get-Content $outFile -TotalCount 30

Write-Host ""
Write-Host "Abrindo no VS Code..." -ForegroundColor Gray
code $outFile

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$outFile = Join-Path (Get-Location) "PROJECT_CONTEXT_MILETO.md"

# Zera o arquivo
Remove-Item $outFile -Force -ErrorAction SilentlyContinue
New-Item -ItemType File -Path $outFile -Force | Out-Null

function Get-CleanFromClipboard {
  $raw = Get-Clipboard -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

  $lines = $raw -split "`r?`n"
  $clean = New-Object System.Collections.Generic.List[string]

  foreach ($l in $lines) {
    if ($l -match '^---PART \d+/\d+ BEGIN---$') { continue }
    if ($l -match '^---PART \d+/\d+ END---$') { continue }
    if ($l -match '^\[PART_LEN\]=') { continue }
    if ($l -match '^\[PART_SHA256\]=') { continue }
    $clean.Add($l)
  }

  $text = ($clean -join "`n").Trim()
  if ($text.Length -lt 200) { return $null }  # evita clipboard errado
  return $text + "`n"
}

for ($i = 1; $i -le 6; $i++) {
  while ($true) {
    Write-Host ""
    Write-Host "PASSO $i/6: Copie o PART $i (inteiro) do chat para o clipboard e pressione ENTER..." -ForegroundColor Cyan
    Read-Host | Out-Null

    $part = Get-CleanFromClipboard
    if ($null -ne $part) {
      Add-Content -Path $outFile -Value $part -Encoding utf8
      $len = (Get-Item $outFile).Length
      Write-Host "OK: PART $i/6 gravado. Tamanho atual: $len bytes." -ForegroundColor Green
      break
    } else {
      Write-Host "Clipboard vazio/pequeno (provável cópia errada). Copie o PART $i novamente e tente de novo." -ForegroundColor Yellow
    }
  }
}

$final = (Get-Item $outFile).Length
Write-Host ""
Write-Host "FINAL: Arquivo criado -> $outFile" -ForegroundColor Green
Write-Host "Tamanho final: $final bytes" -ForegroundColor Green

if ($final -lt 8000) {
  Write-Host "ATENÇÃO: ficou pequeno demais. Alguma PART veio errada (ou não foi copiada inteira)." -ForegroundColor Red
}

Write-Host ""
Write-Host "Preview (primeiras 30 linhas):" -ForegroundColor Gray
Get-Content $outFile -TotalCount 30

Write-Host ""
Write-Host "Abrindo no VS Code..." -ForegroundColor Gray
code $outFile

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$outFile = Join-Path (Get-Location) "PROJECT_CONTEXT_MILETO.md"

# Zera o arquivo
Remove-Item $outFile -Force -ErrorAction SilentlyContinue
New-Item -ItemType File -Path $outFile -Force | Out-Null

function Get-CleanFromClipboard {
  $raw = Get-Clipboard -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

  $lines = $raw -split "`r?`n"
  $clean = New-Object System.Collections.Generic.List[string]

  foreach ($l in $lines) {
    if ($l -match '^---PART \d+/\d+ BEGIN---$') { continue }
    if ($l -match '^---PART \d+/\d+ END---$') { continue }
    if ($l -match '^\[PART_LEN\]=') { continue }
    if ($l -match '^\[PART_SHA256\]=') { continue }
    $clean.Add($l)
  }

  $text = ($clean -join "`n").Trim()
  if ($text.Length -lt 200) { return $null }  # evita clipboard errado
  return $text + "`n"
}

for ($i = 1; $i -le 6; $i++) {
  while ($true) {
    Write-Host ""
    Write-Host "PASSO $i/6: Copie o PART $i (inteiro) do chat para o clipboard e pressione ENTER..." -ForegroundColor Cyan
    Read-Host | Out-Null

    $part = Get-CleanFromClipboard
    if ($null -ne $part) {
      Add-Content -Path $outFile -Value $part -Encoding utf8
      $len = (Get-Item $outFile).Length
      Write-Host "OK: PART $i/6 gravado. Tamanho atual: $len bytes." -ForegroundColor Green
      break
    } else {
      Write-Host "Clipboard vazio/pequeno (provável cópia errada). Copie o PART $i novamente e tente de novo." -ForegroundColor Yellow
    }
  }
}

$final = (Get-Item $outFile).Length
Write-Host ""
Write-Host "FINAL: Arquivo criado -> $outFile" -ForegroundColor Green
Write-Host "Tamanho final: $final bytes" -ForegroundColor Green

if ($final -lt 8000) {
  Write-Host "ATENÇÃO: ficou pequeno demais. Alguma PART veio errada (ou não foi copiada inteira)." -ForegroundColor Red
}

Write-Host ""
Write-Host "Preview (primeiras 30 linhas):" -ForegroundColor Gray
Get-Content $outFile -TotalCount 30

Write-Host ""
Write-Host "Abrindo no VS Code..." -ForegroundColor Gray
code $outFile

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$outFile = Join-Path (Get-Location) "PROJECT_CONTEXT_MILETO.md"

# Zera o arquivo
Remove-Item $outFile -Force -ErrorAction SilentlyContinue
New-Item -ItemType File -Path $outFile -Force | Out-Null

function Get-CleanFromClipboard {
  $raw = Get-Clipboard -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

  $lines = $raw -split "`r?`n"
  $clean = New-Object System.Collections.Generic.List[string]

  foreach ($l in $lines) {
    if ($l -match '^---PART \d+/\d+ BEGIN---$') { continue }
    if ($l -match '^---PART \d+/\d+ END---$') { continue }
    if ($l -match '^\[PART_LEN\]=') { continue }
    if ($l -match '^\[PART_SHA256\]=') { continue }
    $clean.Add($l)
  }

  $text = ($clean -join "`n").Trim()
  if ($text.Length -lt 200) { return $null }  # evita clipboard errado
  return $text + "`n"
}

for ($i = 1; $i -le 6; $i++) {
  while ($true) {
    Write-Host ""
    Write-Host "PASSO $i/6: Copie o PART $i (inteiro) do chat para o clipboard e pressione ENTER..." -ForegroundColor Cyan
    Read-Host | Out-Null

    $part = Get-CleanFromClipboard
    if ($null -ne $part) {
      Add-Content -Path $outFile -Value $part -Encoding utf8
      $len = (Get-Item $outFile).Length
      Write-Host "OK: PART $i/6 gravado. Tamanho atual: $len bytes." -ForegroundColor Green
      break
    } else {
      Write-Host "Clipboard vazio/pequeno (provável cópia errada). Copie o PART $i novamente e tente de novo." -ForegroundColor Yellow
    }
  }
}

$final = (Get-Item $outFile).Length
Write-Host ""
Write-Host "FINAL: Arquivo criado -> $outFile" -ForegroundColor Green
Write-Host "Tamanho final: $final bytes" -ForegroundColor Green

if ($final -lt 8000) {
  Write-Host "ATENÇÃO: ficou pequeno demais. Alguma PART veio errada (ou não foi copiada inteira)." -ForegroundColor Red
}

Write-Host ""
Write-Host "Preview (primeiras 30 linhas):" -ForegroundColor Gray
Get-Content $outFile -TotalCount 30

Write-Host ""
Write-Host "Abrindo no VS Code..." -ForegroundColor Gray
code $outFile

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$outFile = Join-Path (Get-Location) "PROJECT_CONTEXT_MILETO.md"

# Zera o arquivo
Remove-Item $outFile -Force -ErrorAction SilentlyContinue
New-Item -ItemType File -Path $outFile -Force | Out-Null

function Get-CleanFromClipboard {
  $raw = Get-Clipboard -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

  $lines = $raw -split "`r?`n"
  $clean = New-Object System.Collections.Generic.List[string]

  foreach ($l in $lines) {
    if ($l -match '^---PART \d+/\d+ BEGIN---$') { continue }
    if ($l -match '^---PART \d+/\d+ END---$') { continue }
    if ($l -match '^\[PART_LEN\]=') { continue }
    if ($l -match '^\[PART_SHA256\]=') { continue }
    $clean.Add($l)
  }

  $text = ($clean -join "`n").Trim()
  if ($text.Length -lt 200) { return $null }  # evita clipboard errado
  return $text + "`n"
}

for ($i = 1; $i -le 6; $i++) {
  while ($true) {
    Write-Host ""
    Write-Host "PASSO $i/6: Copie o PART $i (inteiro) do chat para o clipboard e pressione ENTER..." -ForegroundColor Cyan
    Read-Host | Out-Null

    $part = Get-CleanFromClipboard
    if ($null -ne $part) {
      Add-Content -Path $outFile -Value $part -Encoding utf8
      $len = (Get-Item $outFile).Length
      Write-Host "OK: PART $i/6 gravado. Tamanho atual: $len bytes." -ForegroundColor Green
      break
    } else {
      Write-Host "Clipboard vazio/pequeno (provável cópia errada). Copie o PART $i novamente e tente de novo." -ForegroundColor Yellow
    }
  }
}

$final = (Get-Item $outFile).Length
Write-Host ""
Write-Host "FINAL: Arquivo criado -> $outFile" -ForegroundColor Green
Write-Host "Tamanho final: $final bytes" -ForegroundColor Green

if ($final -lt 8000) {
  Write-Host "ATENÇÃO: ficou pequeno demais. Alguma PART veio errada (ou não foi copiada inteira)." -ForegroundColor Red
}

Write-Host ""
Write-Host "Preview (primeiras 30 linhas):" -ForegroundColor Gray
Get-Content $outFile -TotalCount 30

Write-Host ""
Write-Host "Abrindo no VS Code..." -ForegroundColor Gray
code $outFile

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$outFile = Join-Path (Get-Location) "PROJECT_CONTEXT_MILETO.md"

# Zera o arquivo
Remove-Item $outFile -Force -ErrorAction SilentlyContinue
New-Item -ItemType File -Path $outFile -Force | Out-Null

function Get-CleanFromClipboard {
  $raw = Get-Clipboard -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

  $lines = $raw -split "`r?`n"
  $clean = New-Object System.Collections.Generic.List[string]

  foreach ($l in $lines) {
    if ($l -match '^---PART \d+/\d+ BEGIN---$') { continue }
    if ($l -match '^---PART \d+/\d+ END---$') { continue }
    if ($l -match '^\[PART_LEN\]=') { continue }
    if ($l -match '^\[PART_SHA256\]=') { continue }
    $clean.Add($l)
  }

  $text = ($clean -join "`n").Trim()
  if ($text.Length -lt 200) { return $null }  # evita clipboard errado
  return $text + "`n"
}

for ($i = 1; $i -le 6; $i++) {
  while ($true) {
    Write-Host ""
    Write-Host "PASSO $i/6: Copie o PART $i (inteiro) do chat para o clipboard e pressione ENTER..." -ForegroundColor Cyan
    Read-Host | Out-Null

    $part = Get-CleanFromClipboard
    if ($null -ne $part) {
      Add-Content -Path $outFile -Value $part -Encoding utf8
      $len = (Get-Item $outFile).Length
      Write-Host "OK: PART $i/6 gravado. Tamanho atual: $len bytes." -ForegroundColor Green
      break
    } else {
      Write-Host "Clipboard vazio/pequeno (provável cópia errada). Copie o PART $i novamente e tente de novo." -ForegroundColor Yellow
    }
  }
}

$final = (Get-Item $outFile).Length
Write-Host ""
Write-Host "FINAL: Arquivo criado -> $outFile" -ForegroundColor Green
Write-Host "Tamanho final: $final bytes" -ForegroundColor Green

if ($final -lt 8000) {
  Write-Host "ATENÇÃO: ficou pequeno demais. Alguma PART veio errada (ou não foi copiada inteira)." -ForegroundColor Red
}

Write-Host ""
Write-Host "Preview (primeiras 30 linhas):" -ForegroundColor Gray
Get-Content $outFile -TotalCount 30

Write-Host ""
Write-Host "Abrindo no VS Code..." -ForegroundColor Gray
code $outFile

