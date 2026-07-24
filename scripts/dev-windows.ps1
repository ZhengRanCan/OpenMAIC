[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectPathPattern = [regex]::Escape($projectRoot)

# A previous Ctrl+C can leave the Node child process alive on Windows. Only
# stop a listener when its command line proves that it belongs to this copy of
# OpenMAIC; never take over an unrelated process on the requested port.
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $isOpenMaicNext =
    $null -ne $processInfo -and
    $processInfo.Name -eq 'node.exe' -and
    $processInfo.CommandLine -match $projectPathPattern -and
    $processInfo.CommandLine -match 'next'

  if (-not $isOpenMaicNext) {
    throw "Port $Port is occupied by PID $($listener.OwningProcess), which is not this OpenMAIC dev server. Stop that process or choose another port."
  }

  Write-Host "Stopping previous OpenMAIC dev server (PID $($listener.OwningProcess))..."
  Stop-Process -Id $listener.OwningProcess -Force
}

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $remaining = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $remaining) { break }
  Start-Sleep -Milliseconds 250
}

if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "Port $Port is still occupied after stopping the previous OpenMAIC server."
}

# Switching Next.js development bundlers can leave client and server artifacts
# that use the same dev URLs but incompatible router runtimes. Clear only this
# generated cache after the old process is gone, then let Next recreate it.
$nextDirectory = Join-Path $projectRoot '.next'
if (Test-Path $nextDirectory) {
  Write-Host 'Clearing generated Next.js development cache...'
  Remove-Item -LiteralPath $nextDirectory -Recurse -Force
}

Set-Location $projectRoot
Write-Host "Starting OpenMAIC on http://localhost:$Port"
& corepack pnpm exec next dev --webpack --port $Port
exit $LASTEXITCODE
