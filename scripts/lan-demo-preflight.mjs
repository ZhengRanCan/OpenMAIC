import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const requiredDemoEnvironment = {
  OPENMAIC_LAN_DEMO_MODE: 'true',
  OPENMAIC_LAN_DEMO_DATA: 'synthetic',
};

// A LAN presentation must not inherit any persistence, delegation, or model
// credentials. Keeping this list explicit makes the refusal message useful
// without ever printing a configuration value.
const forbiddenEnvironment = [
  'ALLOWED_FRAME_ANCESTORS',
  'DEEPTUTOR_FUSION_BASE_URL',
  'DEEPTUTOR_FUSION_TOKEN',
  'DEEPTUTOR_SERVICE_TOKEN',
  'FUSION_DATABASE_URL',
  'FUSION_DEVELOPMENT_MOCK_ENABLED',
  'FUSION_LOCAL_POSTGRES_URL',
  'FUSION_LOCAL_SECRET_FILE',
  'FUSION_LOCAL_SERVICE_ACCOUNT_REF',
  'FUSION_PERSISTENCE_MODE',
  'FUSION_POSTGRES_SECRET_REF',
  'FUSION_SECRET_MANAGER_PROVIDER',
  'FUSION_SERVICE_CLIENT_SECRET',
  'FUSION_SERVICE_CLIENT_SECRET_REF',
  'FUSION_STORAGE_DRIVER',
  'FUSION_WORKLOAD_IDENTITY_PROVIDER',
  'ANTHROPIC_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENAI_API_KEY',
];

const forbiddenEnvironmentFiles = ['.env', '.env.local', '.env.production', '.env.production.local'];

function isCredentialOrProviderSetting(name) {
  return /(?:_API_KEY|_TOKEN|_SECRET|_BASE_URL)$/i.test(name);
}

function privateIpv4Octets(value) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return undefined;
  const octets = value.split('.').map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : undefined;
}

/** A presentation address is intentionally limited to RFC 1918 IPv4 ranges. */
export function isPrivateLanIpv4(value) {
  const octets = privateIpv4Octets(value);
  if (!octets) return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function parseWindowsNetstatListeners(output, port) {
  return output
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (!match) return [];
      const localAddress = match[1].replace(/[\[\]]/g, '');
      const separator = localAddress.lastIndexOf(':');
      if (separator === -1 || Number(localAddress.slice(separator + 1)) !== port) return [];
      return [{ localAddress: match[1], pid: Number(match[2]) }];
    });
}

function portListeners(port) {
  if (process.platform !== 'win32') return [];
  try {
    const output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseWindowsNetstatListeners(output, port);
  } catch {
    // The port bind still gives Next a final OS-level check. A preflight must
    // never alter a system setting merely because netstat is unavailable.
    return [];
  }
}

function nodeSupportsNext(nodeVersion) {
  const match = /^v?(\d+)\.(\d+)\./.exec(nodeVersion);
  if (!match) return false;
  const [major, minor] = match.slice(1).map(Number);
  return major > 20 || (major === 20 && minor >= 9);
}

/**
 * Inspect a demo configuration without changing the host. The dependency
 * injection points make the policy testable without opening a port.
 */
export function inspectLanDemoReadiness({
  projectRoot = process.cwd(),
  env = process.env,
  lanAddress,
  port,
  phase = 'full',
  pathExists = existsSync,
  getPortListeners = portListeners,
  nodeVersion = process.version,
} = {}) {
  const errors = [];
  const normalizedPort = Number(port);
  if (!Number.isSafeInteger(normalizedPort) || normalizedPort < 1024 || normalizedPort > 65535) {
    errors.push('Port must be an integer from 1024 through 65535.');
  }
  if (!isPrivateLanIpv4(lanAddress ?? '')) {
    errors.push('LAN address must be an explicit RFC 1918 IPv4 address (10/8, 172.16/12, or 192.168/16).');
  }
  if (!nodeSupportsNext(nodeVersion)) errors.push('Node.js 20.9 or newer is required.');

  for (const [name, expected] of Object.entries(requiredDemoEnvironment)) {
    if (env[name] !== expected) {
      errors.push(`${name} must be set to ${JSON.stringify(expected)} for a LAN demo.`);
    }
  }
  if (env.NODE_ENV && env.NODE_ENV !== 'production') {
    errors.push('NODE_ENV must be production for the production-like LAN server.');
  }
  for (const name of forbiddenEnvironment) {
    if (env[name]) errors.push(`${name} must not be set for a LAN demo.`);
  }
  for (const name of Object.keys(env)) {
    if (env[name] && isCredentialOrProviderSetting(name) && !forbiddenEnvironment.includes(name)) {
      errors.push(`${name} must not be set for a LAN demo.`);
    }
  }
  for (const file of forbiddenEnvironmentFiles) {
    if (pathExists(path.join(projectRoot, file))) {
      errors.push(`${file} is not allowed for a LAN demo; use only the script-owned synthetic configuration.`);
    }
  }

  if (!pathExists(path.join(projectRoot, 'node_modules', '.pnpm'))) {
    errors.push('pnpm dependencies are missing; run corepack pnpm install before the demo.');
  }
  if (!pathExists(path.join(projectRoot, 'node_modules', 'next', 'package.json'))) {
    errors.push('Next.js is missing; run corepack pnpm install before the demo.');
  }
  for (const lock of ['.next/dev/lock', '.next/lock']) {
    if (pathExists(path.join(projectRoot, lock))) {
      errors.push(`${lock} exists, so another Next instance may still own this OpenMAIC directory. Stop it first; this script will not terminate it.`);
    }
  }
  if (phase === 'full' && !pathExists(path.join(projectRoot, '.next', 'BUILD_ID'))) {
    errors.push('The production build output (.next/BUILD_ID) is missing; run corepack pnpm build first.');
  }
  if (Number.isSafeInteger(normalizedPort)) {
    const listeners = getPortListeners(normalizedPort);
    if (listeners.length) {
      const details = listeners.map(({ localAddress, pid }) => `${localAddress} (PID ${pid})`).join(', ');
      errors.push(`Port ${normalizedPort} is already listening at ${details}. Stop the intended process or choose another port; no process was stopped.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    url:
      isPrivateLanIpv4(lanAddress ?? '') && Number.isSafeInteger(normalizedPort)
        ? `http://${lanAddress}:${normalizedPort}`
        : undefined,
  };
}

export function parsePreflightArguments(argv) {
  const parsed = { phase: 'full' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--lan-address') parsed.lanAddress = argv[++index];
    else if (argument === '--port') parsed.port = argv[++index];
    else if (argument === '--phase') parsed.phase = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (parsed.phase !== 'before-build' && parsed.phase !== 'full') {
    throw new Error('--phase must be before-build or full.');
  }
  return parsed;
}

function runCli() {
  let options;
  try {
    options = parsePreflightArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`LAN demo preflight refused: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const result = inspectLanDemoReadiness(options);
  if (!result.ok) {
    process.stderr.write(`LAN demo preflight refused:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`LAN demo preflight passed. Demo URL: ${result.url}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
