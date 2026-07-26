import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { inspectLanSharedReadiness } from '../../scripts/lan-shared-preflight.mjs';
import { normalizeLanSharedArguments } from '../../scripts/lan-shared-runner.mjs';

const projectRoot = path.resolve('lan-shared-fixture');
const readyPaths = new Set([
  path.join(projectRoot, 'node_modules', 'next', 'package.json'),
  path.join(projectRoot, '.next', 'BUILD_ID'),
]);

function ready(options = {}) {
  return inspectLanSharedReadiness({
    ...options,
    projectRoot,
    env: {
      OPENMAIC_LAN_SHARED_MODE: 'true',
      NEXT_PUBLIC_OPENMAIC_LAN_SHARED_MODE: 'true',
      NODE_ENV: 'production',
      ...(options.env ?? {}),
    },
    lanAddress: options.lanAddress ?? '10.23.13.210',
    port: options.port ?? 3000,
    pathExists: (candidate) => (options.paths ?? readyPaths).has(candidate),
    getListeners: () => options.listeners ?? [],
    getLocalAddresses: () => options.addresses ?? ['10.23.13.210'],
  });
}

test('accepts a built shared workspace with server-side provider settings', () => {
  const result = ready({ env: { DEEPSEEK_API_KEY: 'host-only-key' } });
  assert.equal(result.ok, true);
  assert.equal(result.url, 'http://10.23.13.210:3000');
});

test('refuses a non-local address, missing build, or occupied port', () => {
  const result = ready({
    lanAddress: '8.8.8.8',
    paths: new Set(),
    listeners: ['0.0.0.0:3000 (PID 42)'],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /RFC 1918/);
  assert.match(result.errors.join('\n'), /Production build output/);
  assert.match(result.errors.join('\n'), /PID 42/);
});

test('allows the first preflight before the script creates the production build', () => {
  const result = ready({
    paths: new Set([path.join(projectRoot, 'node_modules', 'next', 'package.json')]),
    phase: 'before-build',
  });
  assert.equal(result.ok, true);
});

test('normalizes pnpm script argument forwarding', () => {
  assert.deepEqual(normalizeLanSharedArguments(['--', '-LanAddress', '10.23.13.210']), [
    '-LanAddress',
    '10.23.13.210',
  ]);
});
