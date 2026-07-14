[CmdletBinding()]
param(
  [string]$Version,
  [ValidateSet('chrome', 'firefox')]
  [string]$Target = 'chrome'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path (Join-Path $root 'dist') $Target
$manifestPath = Join-Path $dist 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Build output is missing: $manifestPath" }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = "v$($manifest.version)" }
if (-not $Version.StartsWith('v')) { $Version = "v$Version" }

& (Join-Path $PSScriptRoot 'validate-extension.ps1') -Target $Target

$releaseDir = Join-Path (Join-Path $root 'dist') 'release-assets'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("many-ai-usage-$([guid]::NewGuid().ToString('N'))")
$extension = if ($Target -eq 'chrome') { 'zip' } else { 'xpi' }
$archive = Join-Path $releaseDir "many-ai-usage-$Version-$Target.$extension"
$checksum = "$archive.sha256"

try {
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  Copy-Item -Path (Join-Path $dist '*') -Destination $staging -Recurse -Force
  if (Test-Path -LiteralPath $archive) { Remove-Item -Force -LiteralPath $archive }
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archive -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($checksum, "$hash  $(Split-Path -Leaf $archive)`n", $utf8NoBom)
  Write-Output "packaged: $archive"
  Write-Output "checksum: $checksum"
}
finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
