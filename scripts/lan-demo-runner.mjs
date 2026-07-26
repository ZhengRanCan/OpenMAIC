import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

/** pnpm forwards its script separator (`--`) as a normal argument on Windows. */
export function normalizeLanDemoArguments(argumentsFromPnpm) {
  return argumentsFromPnpm[0] === '--' ? argumentsFromPnpm.slice(1) : argumentsFromPnpm;
}

function run() {
  const scriptPath = fileURLToPath(new URL('./lan-demo.ps1', import.meta.url));
  const result = spawnSync(
    process.platform === 'win32' ? 'powershell.exe' : 'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      ...normalizeLanDemoArguments(process.argv.slice(2)),
    ],
    { stdio: 'inherit' },
  );
  if (result.error) {
    process.stderr.write(`Unable to start the LAN demo launcher: ${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
