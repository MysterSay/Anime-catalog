$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src = Join-Path $Root 'src'
$Manifests = Join-Path $Root 'manifests'
$Dist = Join-Path $Root 'dist'
$Version = '3.2.0'

function New-BrowserBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Manifest,
        [Parameter(Mandatory = $true)][string]$ArchiveExtension
    )

    $FolderName = "Anime-to-YORU-$Name-v$Version"
    $Target = Join-Path $Dist $FolderName
    if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
    New-Item -ItemType Directory -Path $Target | Out-Null

    Copy-Item (Join-Path $Src '*') $Target -Recurse -Force
    Copy-Item (Join-Path $Manifests $Manifest) (Join-Path $Target 'manifest.json') -Force

    $ZipPath = Join-Path $Dist "$FolderName.zip"
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Compress-Archive -Path (Join-Path $Target '*') -DestinationPath $ZipPath -CompressionLevel Optimal

    if ($ArchiveExtension -eq '.xpi') {
        $XpiPath = Join-Path $Dist "$FolderName.xpi"
        if (Test-Path $XpiPath) { Remove-Item $XpiPath -Force }
        Copy-Item $ZipPath $XpiPath -Force
    }

    Write-Host "Built: $Target"
    Write-Host "       $ZipPath"
}

if (-not (Test-Path $Dist)) { New-Item -ItemType Directory -Path $Dist | Out-Null }

New-BrowserBuild -Name 'Chromium' -Manifest 'manifest.chromium.json' -ArchiveExtension '.zip'
New-BrowserBuild -Name 'Firefox' -Manifest 'manifest.firefox.json' -ArchiveExtension '.xpi'
New-BrowserBuild -Name 'Safari-WebExtension' -Manifest 'manifest.safari.json' -ArchiveExtension '.zip'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
