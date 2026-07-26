[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$LanAddress,
  [ValidateRange(1024, 65535)]
  [int]$Port = 3000,
  [switch]$ConfirmLan
)

$ErrorActionPreference = 'Stop'

if (-not $ConfirmLan) {
  throw 'Pass -ConfirmLan only after confirming that this is a trusted private LAN. This script does not change the firewall, create port forwarding, or publish the service to the internet.'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot

# These markers are the only configuration the launcher supplies. Preflight
# rejects inherited provider, persistence, and credential configuration.
$env:OPENMAIC_LAN_DEMO_MODE = 'true'
$env:OPENMAIC_LAN_DEMO_DATA = 'synthetic'
$env:NODE_ENV = 'production'

& node ./scripts/lan-demo-preflight.mjs --lan-address $LanAddress --port $Port --phase before-build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& corepack pnpm build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& node ./scripts/lan-demo-preflight.mjs --lan-address $LanAddress --port $Port --phase full
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Starting the trusted-LAN demo at http://$LanAddress`:$Port/lan-demo"
Write-Host 'Stop with Ctrl+C. Then verify from the second device that the URL is no longer reachable.'
& corepack pnpm exec next start --hostname $LanAddress --port $Port
exit $LASTEXITCODE
