import type { DelegationCredential } from '../identity/delegation-store';

export interface SecretManager {
  put(ref: string, secret: string): Promise<void>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
}

/**
 * Only this adapter receives delegation material. Database records retain the
 * returned ref, never the serialized credential or any part of its token.
 */
export class SecretManagerDelegationCredentialStore {
  constructor(
    private readonly secrets: SecretManager,
    private readonly prefix = 'fusion/delegations',
  ) {}

  async store(credential: DelegationCredential): Promise<string> {
    const ref = `${this.prefix}/${credential.tokenId}`;
    await this.secrets.put(ref, JSON.stringify(credential));
    return ref;
  }

  async get(
    ref: string,
    lessonSessionId: string,
    now = Date.now(),
  ): Promise<DelegationCredential | undefined> {
    const encoded = await this.secrets.get(ref);
    if (!encoded) return undefined;
    try {
      const credential = JSON.parse(encoded) as DelegationCredential;
      return credential.lessonSessionId === lessonSessionId &&
        credential.expiresAt > Math.floor(now / 1000)
        ? credential
        : undefined;
    } catch {
      return undefined;
    }
  }

  async delete(ref: string): Promise<void> {
    await this.secrets.delete(ref);
  }
}

export interface ServiceAccessTokenProvider {
  getAccessToken(
    scopes: readonly ['classroom-event:write', 'profile-update:submit'],
  ): Promise<string>;
}
