import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import type { SecretManager } from './secret-manager';

type SecretFile = Record<string, string>;

/**
 * Development Only local secret provider. Its file MUST be outside the repo and
 * is rejected outside development/test. It lets the local Docker integration
 * exercise reference-only database persistence without committing credentials.
 */
export class DevelopmentFileSecretProvider implements SecretManager {
  constructor(
    private readonly path: string,
    private readonly environment = process.env.NODE_ENV,
  ) {
    if (environment !== 'development' && environment !== 'test') {
      throw new Error('DevelopmentFileSecretProvider is only available in development or test');
    }
    const relation = relative(resolve(process.cwd()), resolve(path));
    if (!isAbsolute(path) || (!relation.startsWith('..') && !isAbsolute(relation))) {
      throw new Error('Development secret file must be an absolute path outside the repository');
    }
  }

  async put(ref: string, secret: string): Promise<void> {
    const secrets = await this.read();
    secrets[ref] = secret;
    await writeFile(this.path, JSON.stringify(secrets), { encoding: 'utf8', mode: 0o600 });
  }

  async get(ref: string): Promise<string | undefined> {
    return (await this.read())[ref];
  }

  async delete(ref: string): Promise<void> {
    const secrets = await this.read();
    delete secrets[ref];
    await writeFile(this.path, JSON.stringify(secrets), { encoding: 'utf8', mode: 0o600 });
  }

  newReference(prefix = 'fusion/local'): string {
    return `${prefix}/${randomUUID()}`;
  }

  private async read(): Promise<SecretFile> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('invalid development secret file');
      return value as SecretFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
}
