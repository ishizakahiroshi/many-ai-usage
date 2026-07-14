[CmdletBinding()]
param(
  [ValidateSet('chrome', 'firefox')]
  [string]$Target = 'chrome'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path (Join-Path $root 'dist') $Target
$manifestPath = Join-Path $dist 'manifest.json'

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Build output is missing: $manifestPath (run pnpm build first)"
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$package = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
if ([string]$manifest.version -ne [string]$package.version) {
  throw "Version mismatch: manifest=$($manifest.version), package=$($package.version)"
}

foreach ($permission in @('storage', 'tabs', 'scripting')) {
  if ($manifest.permissions -notcontains $permission) { throw "Missing permission: $permission" }
}
if ($Target -eq 'chrome' -and $manifest.optional_host_permissions -notcontains '*://*/*') {
  throw 'Chrome manifest must request *://*/* as optional host access.'
}
if ($Target -eq 'firefox' -and $manifest.browser_specific_settings.gecko.data_collection_permissions.required -notcontains 'none') {
  throw 'Firefox manifest must declare data_collection_permissions.required=[none].'
}

foreach ($file in @('manifest.json', 'popup.html', 'options.html', 'background.js', 'content.js', 'popup.js', 'options.js', 'popup.css', 'options.css', 'assets/icons/icon-512.png')) {
  if (-not (Test-Path -LiteralPath (Join-Path $dist $file))) { throw "Missing bundle file: $file" }
}

foreach ($htmlName in @('popup.html', 'options.html')) {
  $html = Get-Content -Raw -LiteralPath (Join-Path $dist $htmlName)
  if ($html -match '<script(?![^>]*\bsrc=)') { throw "Inline script found in $htmlName" }
  if ($html -match '\son[a-z]+\s*=') { throw "Inline event handler found in $htmlName" }
  if ($html -match 'https?://') { throw "Remote resource found in $htmlName" }
}

Write-Output "valid extension bundle: $Target $($manifest.version)"
