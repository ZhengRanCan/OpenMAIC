import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  inspectLanDemoReadiness,
  isPrivateLanIpv4,
  parsePreflightArguments,
  parseWindowsNetstatListeners,
} from '../../scripts/lan-demo-preflight.mjs';
import { normalizeLanDemoArguments } from '../../scripts/lan-demo-runner.mjs';

const projectRoot = path.resolve('lan-demo-fixture');
const basePaths = new Set([
  path.join(projectRoot, 'node_modules', '.pnpm'),
  path.join(projectRoot, 'node_modules', 'next', 'package.json'),
  path.join(projectRoot, '.next', 'BUILD_ID'),
]);

function ready(options = {}) {
  return inspectLanDemoReadiness({
    projectRoot,
    env: {
      OPENMAIC_LAN_DEMO_MODE: 'true',
      OPENMAIC_LAN_DEMO_DATA: 'synthetic',
      NODE_ENV: 'production',
      ...(options.env ?? {}),
    },
    lanAddress: '192.168.10.24',
    port: 3100,
    pathExists: (candidate) => (options.paths ?? basePaths).has(candidate),
    getPortListeners: () => options.listeners ?? [],
    getLocalLanAddresses: () => options.localLanAddresses ?? ['192.168.10.24'],
    getOpenMaicNextProcesses: () => options.nextProcesses ?? [],
    nodeVersion: 'v20.9.0',
    ...options,
  });
}

test('accepts an explicit RFC 1918 address and a built synthetic demo', () => {
  const result = ready();
  assert.equal(result.ok, true);
  assert.equal(result.url, 'http://192.168.10.24:3100/lan-demo');
});

test('recognizes only RFC 1918 IPv4 presentation addresses', () => {
  assert.equal(isPrivateLanIpv4('10.0.0.7'), true);
  assert.equal(isPrivateLanIpv4('172.31.1.9'), true);
  assert.equal(isPrivateLanIpv4('192.168.1.2'), true);
  assert.equal(isPrivateLanIpv4('172.32.1.9'), false);
  assert.equal(isPrivateLanIpv4('127.0.0.1'), false);
  assert.equal(isPrivateLanIpv4('0.0.0.0'), false);
  assert.equal(isPrivateLanIpv4('8.8.8.8'), false);
});

test('refuses an unsafe address, a missing build artifact, and an occupied port', () => {
  const result = ready({
    lanAddress: '8.8.8.8',
    paths: new Set([
      path.join(projectRoot, 'node_modules', '.pnpm'),
      path.join(projectRoot, 'node_modules', 'next', 'package.json'),
    ]),
    listeners: [{ localAddress: '0.0.0.0:3100', pid: 4123 }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /RFC 1918/);
  assert.match(result.errors.join('\n'), /BUILD_ID/);
  assert.match(result.errors.join('\n'), /PID 4123/);
});

test('refuses a private address that is not configured on this host', () => {
  const result = ready({ lanAddress: '10.23.13.210', localLanAddresses: ['192.168.10.24'] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /not configured on this host/);
});

test('refuses to start a second Next instance from this OpenMAIC directory', () => {
  const result = ready({ nextProcesses: [{ pid: 4123 }] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /PID 4123/);
  assert.match(result.errors.join('\n'), /will not terminate it/);
});

test('refuses inherited credentials and an existing Next lock without revealing values', () => {
  const paths = new Set([...basePaths, path.join(projectRoot, '.next', 'dev', 'lock')]);
  const result = ready({
    paths,
    env: { DEEPSEEK_API_KEY: 'do-not-print-me' },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /DEEPSEEK_API_KEY/);
  assert.match(result.errors.join('\n'), /will not terminate it/);
  assert.doesNotMatch(result.errors.join('\n'), /do-not-print-me/);
});

test('refuses a production-local environment file that Next would load', () => {
  const paths = new Set([...basePaths, path.join(projectRoot, '.env.production.local')]);
  const result = ready({ paths });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /\.env\.production\.local/);
});

test('requires script-owned synthetic demo markers', () => {
  const result = ready({ env: { OPENMAIC_LAN_DEMO_DATA: 'real' } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /OPENMAIC_LAN_DEMO_DATA/);
});

test('refuses the existing access-code credential setting', () => {
  const result = ready({
    env: {
      OPENMAIC_LAN_DEMO_MODE: 'true',
      OPENMAIC_LAN_DEMO_DATA: 'synthetic',
      NODE_ENV: 'production',
      ACCESS_CODE: 'do-not-print-me',
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /ACCESS_CODE/);
  assert.doesNotMatch(result.errors.join('\n'), /do-not-print-me/);
});

test('binds Next to the presenter-confirmed LAN address instead of every interface', () => {
  const launcher = readFileSync(path.resolve('scripts/lan-demo.ps1'), 'utf8');
  assert.match(launcher, /next start --hostname \$LanAddress --port \$Port/);
});

test('parses Windows listeners and only returns the requested port', () => {
  const listeners = parseWindowsNetstatListeners(
    '  TCP    0.0.0.0:3100      0.0.0.0:0      LISTENING       4123\r\n' +
      '  TCP    [::]:3000         [::]:0         LISTENING       5000\r\n',
    3100,
  );
  assert.deepEqual(listeners, [{ localAddress: '0.0.0.0:3100', pid: 4123 }]);
});

test('parses only documented preflight arguments', () => {
  assert.deepEqual(parsePreflightArguments(['--lan-address', '10.1.2.3', '--port', '3200']), {
    lanAddress: '10.1.2.3',
    port: '3200',
    phase: 'full',
  });
  assert.throws(() => parsePreflightArguments(['--unknown']), /Unknown argument/);
});

test('runs the preflight when invoked as a script', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ['scripts/lan-demo-preflight.mjs', '--lan-address', '8.8.8.8', '--port', '3100'],
        {
          cwd: path.resolve('.'),
          env: {
            ...process.env,
            OPENMAIC_LAN_DEMO_MODE: 'true',
            OPENMAIC_LAN_DEMO_DATA: 'synthetic',
            NODE_ENV: 'production',
          },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    /LAN demo preflight refused/,
  );
});

test('removes pnpm’s script argument separator before calling PowerShell', () => {
  assert.deepEqual(
    normalizeLanDemoArguments([
      '--',
      '-LanAddress',
      '10.23.13.210',
      '-Port',
      '3000',
      '-ConfirmLan',
    ]),
    ['-LanAddress', '10.23.13.210', '-Port', '3000', '-ConfirmLan'],
  );
  assert.deepEqual(normalizeLanDemoArguments(['-LanAddress', '10.23.13.210']), [
    '-LanAddress',
    '10.23.13.210',
  ]);
});
