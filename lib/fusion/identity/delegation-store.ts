export interface DelegationCredential {
  token: string;
  tokenId: string;
  learnerId: string;
  audience: 'openmaic';
  scope: string[];
  expiresAt: number;
  lessonSessionId: string;
  courseScopeId?: string;
  courseScopeRevision?: string;
}
const credentials = new Map<string, DelegationCredential>();
export function storeDelegation(credential: DelegationCredential): string {
  const ref = `credential_${credential.tokenId}`;
  credentials.set(ref, credential);
  return ref;
}
export function getDelegation(
  ref: string,
  lessonSessionId: string,
): DelegationCredential | undefined {
  const value = credentials.get(ref);
  return value &&
    value.lessonSessionId === lessonSessionId &&
    value.expiresAt > Math.floor(Date.now() / 1000)
    ? value
    : undefined;
}
export function findDelegation(lessonSessionId: string): DelegationCredential | undefined {
  return [...credentials.values()].find(
    (value) =>
      value.lessonSessionId === lessonSessionId && value.expiresAt > Math.floor(Date.now() / 1000),
  );
}
