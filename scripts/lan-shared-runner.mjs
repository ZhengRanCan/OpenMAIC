import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function normalizeLanSharedArguments(argv) {
  return argv[0] === '--' ? argv.slice(1) : argv;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      './scripts/lan-shared.ps1',
      ...normalizeLanSharedArguments(process.argv.slice(2)),
    ],
    { stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
}
