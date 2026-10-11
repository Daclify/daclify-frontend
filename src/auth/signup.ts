import { PrivateKey } from '@wharfkit/antelope';
import {
  EncryptionPublicKeySchema,
  SignupRoutes,
  signupDeliveryDomain,
  type SignupTicket,
  type RecoveryContext,
  type VaultSecrets,
} from '@daclify/core-protocol';
import { createRecoveryPayload, sealRecoveryDelivery } from '@daclify/core-protocol/sdk';
import type { z } from 'zod';
import { api } from '../api/client';
import { generateVaultSecrets } from './vault';
import { acceptProviderSession, installCreatedVault } from './session';

// Keep original keys only in memory while a failed encrypted-backup write is retried.
let pending:
  | {
      id: string;
      secrets: VaultSecrets;
      context?: RecoveryContext;
      finish?: z.infer<typeof SignupRoutes.signupFinish.input>;
    }
  | undefined;
export function cancelQuickSignup(): void {
  pending = undefined;
}
export async function completeQuickSignup(ticket: SignupTicket, check: () => void) {
  check();
  if (pending && pending.id !== ticket.id) cancelQuickSignup();
  if (!pending) {
    const secrets = await generateVaultSecrets();
    check();
    pending = { id: ticket.id, secrets };
  }
  const attempt = pending;
  if (!attempt.finish) {
    const signing = PrivateKey.from(attempt.secrets.signingKey),
      encryption = EncryptionPublicKeySchema.parse({
        kty: 'EC',
        crv: 'P-256',
        x: attempt.secrets.encryptionPrivateKey.x,
        y: attempt.secrets.encryptionPrivateKey.y,
      }),
      prepared = await api.signupPrepare({
        id: ticket.id,
        signingKey: signing.toPublic().toString(),
        encryptionKey: encryption,
        assistedConsent: true,
      });
    check();
    attempt.context = prepared.context;
    const authorized = await api.signupAuthorize({
      id: ticket.id,
      signature: signing.signMessage(new TextEncoder().encode(prepared.message)).toString(),
    });
    check();
    if (authorized.id !== ticket.id || Date.parse(authorized.expires) <= Date.now())
      throw new Error('AUTH_AUDIENCE');
    const payload = await createRecoveryPayload(attempt.secrets, prepared.context);
    try {
      const keyGrant = await sealRecoveryDelivery(
        payload.key,
        authorized.recipient,
        signupDeliveryDomain(ticket.id, prepared.context),
      );
      check();
      attempt.finish = { id: ticket.id, envelope: payload.envelope, keyGrant };
    } finally {
      payload.key.fill(0);
    }
  }
  const session = await api.signupFinish(attempt.finish);
  check();
  if (!attempt.context) throw new Error('ACCOUNT_KEY_MISMATCH');
  await installCreatedVault(session.account, attempt.secrets, attempt.context, check);
  acceptProviderSession(session.account, session.csrfToken);
  pending = undefined;
  return session.account;
}
