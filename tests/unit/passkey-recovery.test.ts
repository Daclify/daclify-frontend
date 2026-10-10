import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as webauthn from '../../src/auth/webauthn';
const secret = new Uint8Array(32).fill(73);
class Assertion {
  clientDataJSON = new Uint8Array([1]).buffer;
  authenticatorData = new Uint8Array([2]).buffer;
  signature = new Uint8Array([3]).buffer;
}
class Credential {
  id = 'Y3JlZGVudGlhbA';
  response = new Assertion();
  getClientExtensionResults(): unknown {
    return { prf: { results: { first: secret.slice().buffer } } };
  }
}
beforeEach(() => {
  vi.stubGlobal('PublicKeyCredential', Credential);
  vi.stubGlobal('AuthenticatorAssertionResponse', Assertion);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
function prf(value: unknown): unknown {
  const fn = Reflect.get(webauthn, 'passkeyRecoveryMaterial');
  expect(typeof fn).toBe('function');
  if (typeof fn !== 'function') throw new Error('Missing private passkey recovery');
  return fn(value);
}
it('extracts a client-only PRF result without placing it in the login proof', () => {
  const credential = new Credential();
  expect(prf(credential)).toEqual({ credentialKey: 'passkey:' + credential.id, material: secret });
  const proof: unknown = Reflect.apply(webauthn.assertionProof, undefined, [credential]);
  expect(Object.keys(Object(proof)).sort()).toEqual([
    'authenticatorData',
    'clientDataJSON',
    'credentialId',
    'signature',
  ]);
  expect(JSON.stringify(proof)).not.toContain(btoa(String.fromCharCode(...secret)));
});
it('fails closed for unsupported PRF or an invalid output length', () => {
  const credential = new Credential();
  vi.spyOn(credential, 'getClientExtensionResults').mockReturnValue({
    prf: { results: { first: new ArrayBuffer(31) } },
  });
  expect(() => prf(credential)).toThrow();
});
it('requests the fixed private PRF input alongside the actual login challenge', () => {
  const options = webauthn.requestOptions({
    challenge: 'Y2hhbGxlbmdl',
    timeout: 60000,
    rpId: 'app.example.test',
    userVerification: 'required',
  });
  expect(options.extensions).toEqual({
    prf: { eval: { first: new TextEncoder().encode('daclify.passkey.vault-unlock.v1').buffer } },
  });
});

it('enables PRF when creating a new credential without sending private extension output to registration', () => {
  const options = webauthn.creationOptions({
    challenge: 'Y2hhbGxlbmdl',
    rp: { id: 'app.example.test', name: 'Daclify' },
    user: { id: 'YWNjb3VudA', name: 'User', displayName: 'User' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    excludeCredentials: [],
  });
  expect(options.extensions).toEqual({ prf: {} });
});
it('accepts the exact byte window of a BufferSource PRF output', () => {
  const credential = new Credential(),
    bytes = new Uint8Array(40).fill(73);
  vi.spyOn(credential, 'getClientExtensionResults').mockImplementation(() => ({
    prf: { results: { first: bytes.subarray(4, 36) } },
  }));
  expect(webauthn.passkeyRecoveryMaterial(credential)?.material).toEqual(secret);
});
