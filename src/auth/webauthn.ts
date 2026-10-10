import type { PasskeyLoginOptions, PasskeyRegisterOptions } from '../api/client';
import { z } from 'zod';
import { recoveryPrfInput } from '@daclify/core-protocol/sdk';

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
    extensions: { prf: {} },
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
    extensions: { prf: { eval: { first: recoveryPrfInput() } } },
  };
}

function credential(value: unknown): PublicKeyCredential {
  if (!(value instanceof PublicKeyCredential)) throw new Error('PASSKEY_INVALID');
  return value;
}

export function passkeyRecoveryMaterial(
  value: unknown,
): { credentialKey: string; material: Uint8Array } | null {
  const selected = credential(value);
  const extension: unknown = selected.getClientExtensionResults();
  const parsed = z
    .object({
      prf: z
        .object({
          results: z
            .object({
              first: z.custom<ArrayBuffer | ArrayBufferView>(
                (value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value),
              ),
            })
            .optional(),
        })
        .optional(),
    })
    .parse(extension);
  const first = parsed.prf?.results?.first;
  if (!first) return null;
  if (first.byteLength !== 32) throw new Error('PASSKEY_PRF_INVALID');
  const material =
    first instanceof ArrayBuffer
      ? new Uint8Array(first.slice(0))
      : new Uint8Array(first.buffer, first.byteOffset, first.byteLength).slice();
  return { credentialKey: 'passkey:' + selected.id, material };
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
