import type { PasskeyLoginOptions, PasskeyRegisterOptions } from '../api/client';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function creationOptions(
  options: PasskeyRegisterOptions,
): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64UrlToBytes(options.challenge),
    rp: options.rp,
    user: {
      id: base64UrlToBytes(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams.map((item) => ({ type: item.type, alg: item.alg })),
    timeout: options.timeout,
    attestation: options.attestation,
    authenticatorSelection: options.authenticatorSelection,
    excludeCredentials: options.excludeCredentials.map((item) => ({
      type: item.type,
      id: base64UrlToBytes(item.id),
    })),
  };
}

export function requestOptions(options: PasskeyLoginOptions): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64UrlToBytes(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    userVerification: options.userVerification,
  };
}

function credential(value: Credential | null): PublicKeyCredential {
  if (!(value instanceof PublicKeyCredential)) throw new Error('PASSKEY_INVALID');
  return value;
}

export function registrationProof(value: Credential | null): {
  clientDataJSON: string;
  attestationObject: string;
} {
  const created = credential(value);
  if (!(created.response instanceof AuthenticatorAttestationResponse))
    throw new Error('PASSKEY_INVALID');
  return {
    clientDataJSON: bytesToBase64Url(new Uint8Array(created.response.clientDataJSON)),
    attestationObject: bytesToBase64Url(new Uint8Array(created.response.attestationObject)),
  };
}

export function assertionProof(value: Credential | null): {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
} {
  const asserted = credential(value);
  if (!(asserted.response instanceof AuthenticatorAssertionResponse))
    throw new Error('PASSKEY_INVALID');
  return {
    credentialId: asserted.id,
    clientDataJSON: bytesToBase64Url(new Uint8Array(asserted.response.clientDataJSON)),
    authenticatorData: bytesToBase64Url(new Uint8Array(asserted.response.authenticatorData)),
    signature: bytesToBase64Url(new Uint8Array(asserted.response.signature)),
  };
}
