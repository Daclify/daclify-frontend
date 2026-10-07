import { z } from 'zod';
import {
  ApiRoutes,
  ChallengeSchema,
  LoginMessageSchema,
  AccountControlMessageSchema,
  AccountControlRequestSchema,
  VaultAttachMessageSchema,
  NativeSignInMessageSchema,
  NativeChallengeSchema,
  NativeIntentSchema,
  EvmIntentSchema,
  EvmSignInChallengeSchema,
  canonicalEvmSignInMessage,
  ApiOriginSchema,
} from '@daclify/core-protocol';
export const AuthChallengePaths = [
  ApiRoutes.challenge.path,
  '/v1/account/control',
  ApiRoutes.vaultAttachChallenge.path,
  '/v1/account/native/challenge',
  '/v1/account/evm/sign-in/challenge',
];
export function validateAuthChallenge(
  path: string,
  body: unknown,
  input: unknown,
  origin: string,
  audience: string,
  now = Date.now(),
): void {
  ApiOriginSchema.parse(audience);
  const challenge = z.object(ChallengeSchema.shape).parse(body),
    expires = Date.parse(challenge.expires);
  if (expires <= now || expires > now + 330000) throw new Error('AUTH_AUDIENCE');
  if (path === '/v1/account/evm/sign-in/challenge') {
    const value = EvmSignInChallengeSchema.parse(body),
      request = EvmIntentSchema.parse(input),
      message = value.message;
    const nonce = message.match(/^Nonce: ([a-zA-Z0-9]{8,64})$/m)?.[1],
      issued = message.match(/^Issued At: (.+)$/m)?.[1],
      accountId = message.match(/^- urn:daclify:account:([a-f0-9-]{36})$/m)?.[1] ?? null;
    if (
      !nonce ||
      !issued ||
      value.chainId !== request.chainId ||
      value.address.toLowerCase() !== request.address.toLowerCase() ||
      message !==
        canonicalEvmSignInMessage({
          origin,
          audience,
          address: value.address,
          chainId: value.chainId,
          purpose: request.purpose,
          nonce,
          id: value.id,
          issued,
          expires: value.expires,
          accountId,
        })
    )
      throw new Error('AUTH_AUDIENCE');
    return;
  }
  const raw: unknown = JSON.parse(challenge.message);
  if (path === ApiRoutes.challenge.path) {
    const context = LoginMessageSchema.parse(raw),
      request = ApiRoutes.challenge.input.parse(input);
    if (
      context.origin !== origin ||
      context.audience !== audience ||
      context.challenge !== challenge.id ||
      context.expires !== challenge.expires ||
      context.signingKey !== request.signingKey
    )
      throw new Error('AUTH_AUDIENCE');
  } else if (path === '/v1/account/control') {
    const context = AccountControlMessageSchema.parse(raw),
      request = AccountControlRequestSchema.parse(input);
    if (
      context.origin !== origin ||
      context.audience !== audience ||
      context.challengeId !== challenge.id ||
      context.expires !== challenge.expires ||
      context.path !== request.path ||
      context.bodyHash !== request.bodyHash
    )
      throw new Error('AUTH_AUDIENCE');
  } else if (path === ApiRoutes.vaultAttachChallenge.path) {
    const context = VaultAttachMessageSchema.parse(raw),
      request = ApiRoutes.vaultAttachChallenge.input.parse(input);
    if (
      context.origin !== origin ||
      context.audience !== audience ||
      context.id !== challenge.id ||
      context.expires !== challenge.expires ||
      context.signingKey !== request.signingKey ||
      JSON.stringify(context.encryptionKey) !== JSON.stringify(request.encryptionKey)
    )
      throw new Error('AUTH_AUDIENCE');
  } else if (path === '/v1/account/native/challenge') {
    const context = NativeSignInMessageSchema.parse(raw),
      response = NativeChallengeSchema.parse(body),
      request = NativeIntentSchema.parse(input);
    if (
      context.origin !== origin ||
      context.audience !== audience ||
      context.id !== challenge.id ||
      context.expires !== challenge.expires ||
      context.identity.account !== request.account ||
      context.purpose !== request.purpose ||
      JSON.stringify(context.identity) !== JSON.stringify(response.identity) ||
      context.runtime !== response.runtime
    )
      throw new Error('AUTH_AUDIENCE');
  }
}
