[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$LanAddress,
  [ValidateRange(1024, 65535)]
  [int]$Port = 3000,
  [switch]$ConfirmLan
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmLan) {
  throw 'Pass -ConfirmLan only after confirming the temporary private-LAN audience and the host Provider configuration.'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot
$env:OPENMAIC_LAN_SHARED_MODE = 'true'
$env:NEXT_PUBLIC_OPENMAIC_LAN_SHARED_MODE = 'true'
$env:NODE_ENV = 'production'

& corepack pnpm lan-shared:preflight -- --lan-address $LanAddress --port $Port --phase before-build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& corepack pnpm build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& corepack pnpm lan-shared:preflight -- --lan-address $LanAddress --port $Port
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Host workspace: http://localhost:$Port"
Write-Host "LAN shared workspace: http://${LanAddress}:$Port"
& corepack pnpm exec next start --hostname 0.0.0.0 --port $Port
exit $LASTEXITCODE
