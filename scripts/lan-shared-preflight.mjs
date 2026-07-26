import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function privateIpv4(value) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const octets = value.split('.').map(Number);
  return (
    octets.every((octet) => octet >= 0 && octet <= 255) &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168))
  );
}

function netstatListeners(port) {
  if (process.platform !== 'win32') return [];
  try {
    return execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
        if (
          !match ||
          Number(
            match[1]
              .replace(/[\[\]]/g, '')
              .split(':')
              .at(-1),
          ) !== port
        )
          return [];
        return [`${match[1]} (PID ${match[2]})`];
      });
  } catch {
    return [];
  }
}

function localAddresses() {
  if (process.platform !== 'win32') return [];
  try {
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty IPAddress | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8' },
    ).trim();
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((value) => typeof value === 'string');
  } catch {
    return [];
  }
}

export function inspectLanSharedReadiness({
  projectRoot = process.cwd(),
  env = process.env,
  lanAddress,
  port,
  phase = 'full',
  pathExists = existsSync,
  getListeners = netstatListeners,
  getLocalAddresses = localAddresses,
} = {}) {
  const errors = [];
  const normalizedPort = Number(port);
  if (!privateIpv4(lanAddress ?? ''))
    errors.push('LAN address must be an explicit RFC 1918 IPv4 address.');
  else if (!getLocalAddresses().includes(lanAddress)) {
    errors.push('LAN address is not configured on this host.');
  }
  if (!Number.isSafeInteger(normalizedPort) || normalizedPort < 1024 || normalizedPort > 65535) {
    errors.push('Port must be an integer from 1024 through 65535.');
  }
  if (env.OPENMAIC_LAN_SHARED_MODE !== 'true')
    errors.push('OPENMAIC_LAN_SHARED_MODE must be true.');
  if (env.NEXT_PUBLIC_OPENMAIC_LAN_SHARED_MODE !== 'true') {
    errors.push('NEXT_PUBLIC_OPENMAIC_LAN_SHARED_MODE must be true.');
  }
  if (env.NODE_ENV && env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production.');
  if (!pathExists(path.join(projectRoot, 'node_modules', 'next', 'package.json'))) {
    errors.push('Next.js is missing; run corepack pnpm install first.');
  }
  if (phase === 'full' && !pathExists(path.join(projectRoot, '.next', 'BUILD_ID'))) {
    errors.push('Production build output is missing; run corepack pnpm build first.');
  }
  if (Number.isSafeInteger(normalizedPort)) {
    const listeners = getListeners(normalizedPort);
    if (listeners.length)
      errors.push(`Port ${normalizedPort} is already listening at ${listeners.join(', ')}.`);
  }
  return {
    ok: errors.length === 0,
    errors,
    url:
      privateIpv4(lanAddress ?? '') && Number.isSafeInteger(normalizedPort)
        ? `http://${lanAddress}:${normalizedPort}`
        : undefined,
  };
}

function parseArguments(argv) {
  const result = { phase: 'full' };
  const argumentsToParse = argv[0] === '--' ? argv.slice(1) : argv;
  for (let index = 0; index < argumentsToParse.length; index += 1) {
    if (argumentsToParse[index] === '--lan-address') result.lanAddress = argumentsToParse[++index];
    else if (argumentsToParse[index] === '--port') result.port = argumentsToParse[++index];
    else if (argumentsToParse[index] === '--phase') result.phase = argumentsToParse[++index];
    else throw new Error(`Unknown argument: ${argumentsToParse[index]}`);
  }
  if (result.phase !== 'before-build' && result.phase !== 'full') {
    throw new Error('--phase must be before-build or full.');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = inspectLanSharedReadiness(parseArguments(process.argv.slice(2)));
    if (!result.ok) throw new Error(result.errors.join('\n- '));
    process.stdout.write(`LAN shared preflight passed. Workspace URL: ${result.url}\n`);
  } catch (error) {
    process.stderr.write(`LAN shared preflight refused:\n- ${error.message}\n`);
    process.exitCode = 1;
  }
}
