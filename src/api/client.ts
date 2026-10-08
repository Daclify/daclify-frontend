import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { ModuleApiRoutes, VERSION as MODULE_VERSION, type ModuleState } from '@daclify/modules';
import { ArchiveRoutes } from '@daclify/modules/archive';
import { z } from 'zod';
import {
  ServiceCheckoutSchema,
  ServiceReceiptSchema,
  ServiceReceiptsSchema,
  MemberProfileSchema,
  SignInOptionsSchema,
  SignInMethodsSchema,
  EmailStartSchema,
  EmailSubjectSchema,
  PasskeyRegisterOptionsSchema,
  PasskeyLoginOptionsSchema,
  PasskeyRegisteredSchema,
  EvmLinkSchema,
  EvmLinksSchema,
  MarketplaceSchema,
  NamesServiceSchema,
  NameQuoteSchema,
  DocsAgentStatusSchema,
  DocsAnswerSchema,
  ContractFailureMessages,
  ApiRoutes,
  IdSchema,
  daoPaymentKey,
  HostedUploadSchema,
  HostedIntentSchema,
  ErrorSchema,
  type HostedUpload,
  type Account,
  type DaoSummary,
  type Network,
  type UserMembership,
  SessionSchema,
  AccountControlPaths,
  AccountControlChallengeSchema,
  type AccountControlChallenge,
  type AccountControlProof,
  TelegramAuthorizationSchema,
  TelegramStartSchema,
  SignInPasskeyRegisterSchema,
  SignInPasskeyLoginSchema,
  SignInEmailSchema,
  SignInEmailCodeSchema,
  SignInProofSchema,
  SignInRemoveSchema,
  TelegramPendingPairSchema,
  NativeChallengeSchema,
  NativeIntentSchema,
  NativeFinishSchema,
  NativeIdentitySchema,
  NativeLinksSchema,
  type NativeProof,
  EvmIntentSchema,
  EvmFinishSchema,
  EvmSignInChallengeSchema,
  EvmGovernanceBindingSchema,
  EvmRelaySchema,
  CredentialHistorySchema,
  type EvmRelay,
} from '@daclify/core-protocol';
import type { instruction } from '@daclify/core-protocol/sdk';
import { csrfStorageKey, resolveApiUrl, currentOperator, assertOperatorDao } from './networks';
import { AuthChallengePaths, validateAuthChallenge } from '../auth/audience';
import {
  HostingRoutes,
  PaymentRoutes,
  DirectoryRoutes,
  StorageBillingRoutes,
  type DaoRef,
} from '@daclify/core-protocol';
export class ApiFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export type SignInOptions = z.infer<typeof SignInOptionsSchema>;
export type SignInMethods = z.infer<typeof SignInMethodsSchema>;
export type PasskeyRegisterOptions = z.infer<typeof PasskeyRegisterOptionsSchema>;
export type PasskeyLoginOptions = z.infer<typeof PasskeyLoginOptionsSchema>;
export type ServiceReceipt = z.infer<typeof ServiceReceiptSchema>;
let accountControlSigner:
  ((challenge: AccountControlChallenge) => Promise<AccountControlProof>) | undefined;
export function setAccountControlSigner(
  signer: (challenge: AccountControlChallenge) => Promise<AccountControlProof>,
): void {
  accountControlSigner = signer;
}
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  input?: unknown,
  timeoutMs = 15000,
): Promise<T> {
  const url = resolveApiUrl(path),
    csrfKey = csrfStorageKey();
  const checkNetwork = () => {
    if (url !== resolveApiUrl(path) || csrfKey !== csrfStorageKey())
      throw new ApiFailure('WALLET_CONTEXT_CHANGED');
  };
  const operator = currentOperator();
  if (operator) {
    const selected = new URL(url, window.location.origin);
    const id =
      selected.pathname.match(/^\/v1\/daos\/([^/]+)/)?.[1] ?? selected.searchParams.get('daoId');
    if (id && id !== operator.reference.daoId) throw new ApiFailure('OPERATOR_DAO');
    if (typeof input === 'object' && input !== null && 'dao' in input) {
      const { DaoRefSchema } = await import('@daclify/core-protocol');
      assertOperatorDao(DaoRefSchema.parse(input.dao));
    }
  }
  const csrf = sessionStorage.getItem(csrfKey) ?? '';
  const encoded = input === undefined ? undefined : JSON.stringify(input);
  const controlHeaders: Record<string, string> = {};
  if (encoded !== undefined && AccountControlPaths.some((route) => route === path)) {
    if (!accountControlSigner) throw new ApiFailure('ACCOUNT_CONTROL_REQUIRED');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded));
    const bodyHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const challenge = await request('/v1/account/control', AccountControlChallengeSchema, {
      path,
      bodyHash,
    });
    checkNetwork();
    controlHeaders['x-account-intent-id'] = challenge.id;
    const proof = await accountControlSigner(challenge);
    if (proof.kind === 'root') controlHeaders['x-account-signature'] = proof.signature;
    else controlHeaders['x-account-proof'] = JSON.stringify(proof);
  }
  checkNetwork();
  const response = await fetch(url, {
    method: input === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: {
      ...(input === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf }),
      ...controlHeaders,
    },
    ...(encoded === undefined ? {} : { body: encoded }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = response.status === 204 ? null : await response.json();
  checkNetwork();
  if (!response.ok) {
    const error = ErrorSchema.safeParse(body);
    throw new ApiFailure(error.success ? error.data.code : 'SERVICE_UNAVAILABLE');
  }
  const result = schema.parse(body);
  if (operator && path === ApiRoutes.network.path) {
    const network = ApiRoutes.network.response.parse(result);
    if (
      network.chainId !== operator.reference.chainId ||
      network.runtime !== operator.reference.contract
    )
      throw new ApiFailure('OPERATOR_DAO');
  }
  if (operator && typeof result === 'object' && result !== null && 'reference' in result) {
    const { DaoRefSchema } = await import('@daclify/core-protocol');
    const reference = DaoRefSchema.safeParse(result.reference);
    if (reference.success) assertOperatorDao(reference.data);
  }

  if (path.startsWith('/v1/hosting/') || path.startsWith('/v1/payments/')) {
    const requestDao =
      typeof input === 'object' && input !== null && 'dao' in input
        ? input.dao
        : new URL(url, window.location.origin).searchParams.get('dao');
    const expected = typeof requestDao === 'string' ? JSON.parse(requestDao) : requestDao;
    if (expected && typeof result === 'object' && result !== null && 'dao' in result) {
      const { DaoRefSchema } = await import('@daclify/core-protocol');
      if (
        daoPaymentKey(DaoRefSchema.parse(result.dao)) !==
        daoPaymentKey(DaoRefSchema.parse(expected))
      )
        throw new ApiFailure('DAO_REFERENCE');
    }
  }
  if (AuthChallengePaths.includes(path))
    validateAuthChallenge(
      path,
      result,
      input,
      window.location.origin,
      new URL(resolveApiUrl('/'), window.location.origin).origin,
    );
  return result;
}
export function verifiedModuleRelease(state: ModuleState): ModuleState {
  return {
    ...state,
    modules: state.modules.map((module) => ({
      ...module,
      compatible: module.compatible && module.deployment.version === MODULE_VERSION,
      codeVerified:
        module.codeVerified &&
        module.deployment.codeHash === ModuleCodeHashes[module.deployment.id],
    })),
  };
}
export const api = {
  hubDirectory: async () => {
    const all = await request(
      DirectoryRoutes.hubDirectory.path,
      DirectoryRoutes.hubDirectory.response,
    );
    let cursor = all.next;
    while (cursor !== null) {
      const page = await request(
        DirectoryRoutes.hubDirectory.path + '?after=' + cursor,
        DirectoryRoutes.hubDirectory.response,
      );
      if (page.next !== null && BigInt(page.next) <= BigInt(cursor))
        throw new ApiFailure('CHAIN_RESPONSE_INVALID');
      all.entries.push(...page.entries);
      all.skipped += page.skipped;
      cursor = page.next;
    }
    all.next = null;
    return all;
  },
  hostingStatus: (dao: DaoRef) =>
    request(
      HostingRoutes.hostingStatus.path + '?dao=' + encodeURIComponent(JSON.stringify(dao)),
      HostingRoutes.hostingStatus.response,
    ),
  hostingChange: (input: z.infer<typeof HostingRoutes.hostingChange.input>) =>
    request(
      HostingRoutes.hostingChange.path,
      HostingRoutes.hostingChange.response,
      HostingRoutes.hostingChange.input.parse(input),
      60000,
    ),
  paymentStatus: (dao: DaoRef) =>
    request(
      PaymentRoutes.paymentStatus.path + '?dao=' + encodeURIComponent(JSON.stringify(dao)),
      PaymentRoutes.paymentStatus.response,
    ),
  paymentCatalogue: (dao: DaoRef) =>
    request(
      PaymentRoutes.paymentCatalogue.path + '?dao=' + encodeURIComponent(JSON.stringify(dao)),
      PaymentRoutes.paymentCatalogue.response,
    ),
  paymentOnboard: (input: z.infer<typeof PaymentRoutes.paymentOnboard.input>) =>
    request(
      PaymentRoutes.paymentOnboard.path,
      PaymentRoutes.paymentOnboard.response,
      PaymentRoutes.paymentOnboard.input.parse(input),
      60000,
    ),
  paymentProduct: (input: z.infer<typeof PaymentRoutes.paymentProduct.input>) =>
    request(
      PaymentRoutes.paymentProduct.path,
      PaymentRoutes.paymentProduct.response,
      PaymentRoutes.paymentProduct.input.parse(input),
    ),
  paymentCheckout: (input: z.infer<typeof PaymentRoutes.paymentCheckout.input>) =>
    request(
      PaymentRoutes.paymentCheckout.path,
      PaymentRoutes.paymentCheckout.response,
      PaymentRoutes.paymentCheckout.input.parse(input),
    ),
  paymentOrder: (id: string) =>
    request(
      PaymentRoutes.paymentOrder.path.replace(':id', z.uuid().parse(id)),
      PaymentRoutes.paymentOrder.response,
    ),
  paymentRefund: (input: z.infer<typeof PaymentRoutes.paymentRefund.input>) =>
    request(
      PaymentRoutes.paymentRefund.path,
      PaymentRoutes.paymentRefund.response,
      PaymentRoutes.paymentRefund.input.parse(input),
      60000,
    ),
  paymentCredential: (dao: DaoRef) =>
    request(PaymentRoutes.paymentCredential.path, PaymentRoutes.paymentCredential.response, {
      dao,
    }),
  paymentRevoke: (dao: DaoRef) =>
    request(PaymentRoutes.paymentRevoke.path, PaymentRoutes.paymentRevoke.response, { dao }),
  vaultAttachChallenge: (input: z.infer<typeof ApiRoutes.vaultAttachChallenge.input>) =>
    request(
      ApiRoutes.vaultAttachChallenge.path,
      ApiRoutes.vaultAttachChallenge.response,
      ApiRoutes.vaultAttachChallenge.input.parse(input),
    ),
  attachVault: (id: string, signature: string) =>
    request(
      ApiRoutes.vaultAttach.path,
      ApiRoutes.vaultAttach.response,
      ApiRoutes.vaultAttach.input.parse({ id, signature }),
    ),
  spendingReport: (daoId: string) =>
    request(
      ApiRoutes.spendingReport.path.replace(':id', IdSchema.parse(daoId)),
      ApiRoutes.spendingReport.response,
      undefined,
      60000,
    ),
  spendingCsv: (daoId: string) =>
    request(
      ApiRoutes.spendingCsv.path.replace(':id', IdSchema.parse(daoId)),
      ApiRoutes.spendingCsv.response,
      undefined,
      60000,
    ),
  brandImage: (daoId: string, slot: 'logo' | 'cover') =>
    request(
      ApiRoutes.branding.path.replace(':id', IdSchema.parse(daoId)).replace(':slot', slot),
      ApiRoutes.branding.response,
    ),
  content: async (daoId: string) => {
    const path = ApiRoutes.content.path.replace(':id', IdSchema.parse(daoId));
    const all = await request(path, ApiRoutes.content.response);
    while (Object.values(all.next).some((cursor) => cursor !== null)) {
      const query = new URLSearchParams({
        members: all.next.members ?? 'done',
        documents: all.next.documents ?? 'done',
        keyGrants: all.next.keyGrants ?? 'done',
        epochs: all.next.epochs ?? 'done',
      });
      const page = await request(path + '?' + query.toString(), ApiRoutes.content.response);
      if (JSON.stringify(page.dao) !== JSON.stringify(all.dao))
        throw new ApiFailure('DAO_REFERENCE');
      for (const key of ['members', 'documents', 'keyGrants', 'epochs'] as const) {
        const previous = all.next[key],
          next = page.next[key];
        if (next !== null && (previous === null || BigInt(next) <= BigInt(previous)))
          throw new ApiFailure('CHAIN_RESPONSE_INVALID');
      }
      all.members.push(...page.members);
      all.documents.push(...page.documents);
      all.keyGrants.push(...page.keyGrants);
      all.epochs.push(...page.epochs);
      all.next = page.next;
    }
    return all;
  },
  cardRamQuote: (input: z.infer<typeof ApiRoutes.ramCardQuote.input>) =>
    request(
      ApiRoutes.ramCardQuote.path,
      ApiRoutes.ramCardQuote.response,
      ApiRoutes.ramCardQuote.input.parse(input),
    ),
  cardRamCheckout: (input: z.infer<typeof ApiRoutes.ramCardCheckout.input>) =>
    request(
      ApiRoutes.ramCardCheckout.path,
      ApiRoutes.ramCardCheckout.response,
      ApiRoutes.ramCardCheckout.input.parse(input),
    ),
  cardRamReconcile: (id: string) =>
    request(
      ApiRoutes.ramCardReconcile.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.ramCardReconcile.response,
      {},
      60000,
    ),
  cardRamStatus: (id: string) =>
    request(
      ApiRoutes.ramCardStatus.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.ramCardStatus.response,
    ),
  storage: () => request(ApiRoutes.storage.path, ApiRoutes.storage.response),
  ramQuote: (input: z.infer<typeof ApiRoutes.ramQuote.input>) =>
    request(
      ApiRoutes.ramQuote.path,
      ApiRoutes.ramQuote.response,
      ApiRoutes.ramQuote.input.parse(input),
    ),
  ramUsage: async (dao: DaoRef) => {
    const result = await request(
      ApiRoutes.ramUsage.path.replace(':id', IdSchema.parse(dao.daoId)),
      ApiRoutes.ramUsage.response,
    );
    if (daoPaymentKey(result.dao) !== daoPaymentKey(dao)) throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archivePreview: async (input: z.infer<typeof ArchiveRoutes.preview.input>) => {
    const result = await request(
      ArchiveRoutes.preview.path,
      ArchiveRoutes.preview.response,
      ArchiveRoutes.preview.input.parse(input),
      60000,
    );
    if (daoPaymentKey(result.dao) !== daoPaymentKey(input.dao))
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archiveExport: async (input: z.infer<typeof ArchiveRoutes.export.input>) => {
    const result = await request(
      ArchiveRoutes.export.path,
      ArchiveRoutes.export.response,
      ArchiveRoutes.export.input.parse(input),
      60000,
    );
    if (daoPaymentKey(result.dao) !== daoPaymentKey(input.selection.dao))
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archiveExports: async (dao: DaoRef, cursor?: string) => {
    const input = ArchiveRoutes.list.input.parse({ dao, ...(cursor ? { cursor } : {}) }),
      result = await request(
        ArchiveRoutes.list.path +
          '?dao=' +
          encodeURIComponent(JSON.stringify(input.dao)) +
          (input.cursor ? '&cursor=' + input.cursor : ''),
        ArchiveRoutes.list.response,
      );
    if (
      daoPaymentKey(result.dao) !== daoPaymentKey(dao) ||
      result.exports.some((e) => daoPaymentKey(e.dao) !== daoPaymentKey(dao))
    )
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archiveRefresh: async (dao: DaoRef, id: string) => {
    const result = await request(
      ArchiveRoutes.reconcile.path.replace(':id', z.uuid().parse(id)),
      ArchiveRoutes.reconcile.response,
      {},
      60000,
    );
    if (result.id !== id || daoPaymentKey(result.dao) !== daoPaymentKey(dao))
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archiveAttest: async (
    dao: DaoRef,
    id: string,
    value: z.input<typeof ArchiveRoutes.attest.input>,
  ) => {
    const input = ArchiveRoutes.attest.input.parse(value),
      result = await request(
        ArchiveRoutes.attest.path.replace(':id', z.uuid().parse(id)),
        ArchiveRoutes.attest.response,
        input,
        60000,
      );
    if (
      result.id !== id ||
      daoPaymentKey(result.dao) !== daoPaymentKey(dao) ||
      result.anchor?.manifest_commitment !== input.manifestCommitment ||
      result.anchor.descriptor_commitment !== input.descriptorCommitment ||
      result.anchor.backup_commitment !== input.backupCommitment ||
      result.anchor.retention_seconds !== input.retentionSeconds
    )
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archiveBackup: async (dao: DaoRef, id: string, expectedManifestCommitment: string) => {
    const input = ArchiveRoutes.backup.input.parse({ expectedManifestCommitment });
    const result = await request(
      ArchiveRoutes.backup.path.replace(':id', z.uuid().parse(id)),
      ArchiveRoutes.backup.response,
      input,
      60000,
    );
    if (
      result.id !== id ||
      daoPaymentKey(result.dao) !== daoPaymentKey(dao) ||
      result.backup?.manifestCommitment !== expectedManifestCommitment
    )
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archiveBundle: async (dao: DaoRef, id: string) => {
    const result = await request(
      ArchiveRoutes.bundle.path.replace(':id', z.uuid().parse(id)),
      ArchiveRoutes.bundle.response,
      undefined,
      60000,
    );
    if (result.id !== id || daoPaymentKey(result.manifest.dao) !== daoPaymentKey(dao))
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  storageBilling: async (dao: DaoRef) => {
    const result = await request(
      StorageBillingRoutes.storageBillingStatus.path +
        '?dao=' +
        encodeURIComponent(JSON.stringify(dao)),
      StorageBillingRoutes.storageBillingStatus.response,
    );
    if (daoPaymentKey(result.dao) !== daoPaymentKey(dao)) throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  storageApprove: async (input: z.infer<typeof StorageBillingRoutes.storageApprove.input>) => {
    const result = await request(
      StorageBillingRoutes.storageApprove.path,
      StorageBillingRoutes.storageApprove.response,
      StorageBillingRoutes.storageApprove.input.parse(input),
      60000,
    );
    if (daoPaymentKey(result.dao) !== daoPaymentKey(input.dao))
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  storageUsage: async (dao: DaoRef) => {
    const result = await request(
      ApiRoutes.storageUsage.path.replace(':id', encodeURIComponent(dao.daoId)),
      ApiRoutes.storageUsage.response,
    );
    if (daoPaymentKey(result.dao) !== daoPaymentKey(dao)) throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  upload: (input: HostedUpload) =>
    request(
      ApiRoutes.upload.path,
      ApiRoutes.upload.response,
      HostedUploadSchema.parse(input),
      60000,
    ),
  uploadStatus: (requestId: string) =>
    request(
      ApiRoutes.uploadStatus.path.replace(':requestId', z.uuid().parse(requestId)),
      ApiRoutes.uploadStatus.response,
    ),
  reconcileUpload: (requestId: string) =>
    request(
      ApiRoutes.uploadReconcile.path.replace(':requestId', z.uuid().parse(requestId)),
      ApiRoutes.uploadReconcile.response,
      {},
      60000,
    ),
  documentBytes: (daoId: string, documentId: string, version: number) =>
    request(
      ApiRoutes.documentBytes.path
        .replace(':id', IdSchema.parse(daoId))
        .replace(':documentId', IdSchema.parse(documentId))
        .replace(':version', String(HostedIntentSchema.shape.version.parse(version))),
      ApiRoutes.documentBytes.response,
      undefined,
      30000,
    ),
  moduleState: (daoId: string, query: z.infer<typeof ModuleApiRoutes.state.query> = {}) =>
    request(
      ModuleApiRoutes.state.path.replace(':id', IdSchema.parse(daoId)) +
        '?' +
        new URLSearchParams(
          Object.entries(ModuleApiRoutes.state.query.parse(query)).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, value]],
          ),
        ).toString(),
      ModuleApiRoutes.state.response.transform(verifiedModuleRelease),
    ),
  treasury: (daoId: string) =>
    request(
      ApiRoutes.treasury.path.replace(':id', IdSchema.parse(daoId)),
      ApiRoutes.treasury.response,
    ),
  settle: (input: z.infer<typeof ApiRoutes.settle.input>) =>
    request(ApiRoutes.settle.path, ApiRoutes.settle.response, ApiRoutes.settle.input.parse(input)),
  finalize: (input: z.infer<typeof ModuleApiRoutes.finalize.input>) =>
    request(
      ModuleApiRoutes.finalize.path,
      ModuleApiRoutes.finalize.response,
      ModuleApiRoutes.finalize.input.parse(input),
    ),
  network: (): Promise<Network> => request(ApiRoutes.network.path, ApiRoutes.network.response),
  daos: async (): Promise<DaoSummary[]> => {
    const page = await request(ApiRoutes.daos.path, ApiRoutes.daos.response);
    let cursor = page.next;
    while (cursor !== null) {
      const next = await request(ApiRoutes.daos.path + '?after=' + cursor, ApiRoutes.daos.response);
      if (next.next !== null && BigInt(next.next) <= BigInt(cursor))
        throw new ApiFailure('CHAIN_RESPONSE_INVALID');
      page.daos.push(...next.daos);
      cursor = next.next;
    }
    const operator = currentOperator();
    return operator
      ? page.daos.filter((d) => daoPaymentKey(d.reference) === daoPaymentKey(operator.reference))
      : page.daos;
  },
  challenge: (signingKey: string) =>
    request(ApiRoutes.challenge.path, ApiRoutes.challenge.response, { signingKey }),
  login: async (
    challengeId: string,
    signature: string,
    encryptionKey: Account['encryptionKey'],
  ) => {
    const result = await request(ApiRoutes.login.path, ApiRoutes.login.response, {
      challengeId,
      signature,
      encryptionKey,
    });
    sessionStorage.setItem(csrfStorageKey(), result.csrfToken);
    return result.account;
  },
  me: async (): Promise<Account> =>
    (await request(ApiRoutes.me.path, ApiRoutes.me.response)).account,
  memberships: async (): Promise<UserMembership[]> => {
    const memberships = (await request(ApiRoutes.memberships.path, ApiRoutes.memberships.response))
        .memberships,
      operator = currentOperator();
    return operator
      ? memberships.filter((m) => daoPaymentKey(m.dao) === daoPaymentKey(operator.reference))
      : memberships;
  },
  memberProfile: (daoId: string, memberId: string) =>
    request(
      `/v1/profile?daoId=${IdSchema.parse(daoId)}&memberId=${IdSchema.parse(memberId)}`,
      MemberProfileSchema,
    ),
  governance: (daoId: string) =>
    request(
      ApiRoutes.governance.path.replace(':id', IdSchema.parse(daoId)),
      ApiRoutes.governance.response,
    ),
  execute: (dao: DaoSummary['reference'], ballotId: string) =>
    request(
      ModuleApiRoutes.execute.path,
      ModuleApiRoutes.execute.response,
      ModuleApiRoutes.execute.input.parse({ dao, ballotId }),
    ),
  platformStatus: () => request(ApiRoutes.status.path, ApiRoutes.status.response),
  creationOrder: (input: z.infer<typeof ApiRoutes.creationOrder.input>) =>
    request(
      ApiRoutes.creationOrder.path,
      ApiRoutes.creationOrder.response,
      ApiRoutes.creationOrder.input.parse(input),
      60000,
    ),
  creationOrderStatus: (id: string) =>
    request(
      ApiRoutes.creationOrderStatus.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.creationOrderStatus.response,
    ),
  creationCheckout: (id: string) =>
    request(
      ApiRoutes.creationCheckout.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.creationCheckout.response,
      {},
    ),
  creationFulfill: (id: string) =>
    request(
      ApiRoutes.creationFulfill.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.creationFulfill.response,
      {},
      60000,
    ),
  relay: (requestData: instruction, sig: string) =>
    request(ApiRoutes.relay.path, ApiRoutes.relay.response, { request: requestData, sig }),
  serviceCheckout: () => request('/v1/billing/checkout', ServiceCheckoutSchema, {}),
  serviceReceipts: () => request('/v1/billing/receipts', ServiceReceiptsSchema),
  signInOptions: () => request('/v1/sign-in/options', SignInOptionsSchema),
  resumeSession: () => request('/v1/sign-in/session', SessionSchema, {}),
  startTelegram: (mode: 'login' | 'pair', returnTo?: string) =>
    request(
      `/v1/sign-in/telegram/oidc/${mode}/start`,
      TelegramAuthorizationSchema,
      TelegramStartSchema.parse({ returnTo }),
    ),
  telegramPendingPair: (id: string) =>
    request(`/v1/sign-in/telegram/oidc/pair/${z.uuid().parse(id)}`, TelegramPendingPairSchema),
  confirmTelegramPair: (id: string) =>
    request('/v1/sign-in/telegram/oidc/pair/confirm', ApiRoutes.providerLink.response, {
      id: z.uuid().parse(id),
    }),
  signInMethods: () => request('/v1/sign-in/methods', SignInMethodsSchema),
  credentialHistory: (before?: string) =>
    request(
      '/v1/account/history' + (before ? '?before=' + encodeURIComponent(before) : ''),
      CredentialHistorySchema,
    ),
  nativeLinks: () => request('/v1/account/native', NativeLinksSchema),
  nativeChallenge: (purpose: 'login' | 'pair', account: string) =>
    request(
      '/v1/account/native/challenge',
      NativeChallengeSchema,
      NativeIntentSchema.parse({ purpose, account, permission: 'active' }),
    ),
  nativeFinish: (purpose: 'login' | 'pair', id: string, proof: NativeProof) =>
    purpose === 'login'
      ? request('/v1/sign-in/native', SessionSchema, NativeFinishSchema.parse({ id, proof }))
      : request(
          '/v1/account/native/link',
          NativeIdentitySchema,
          NativeFinishSchema.parse({ id, proof }),
        ),
  unlinkNative: (chainId: string) => request('/v1/account/native/unlink', z.null(), { chainId }),
  startEmailLink: (email: string) =>
    request('/v1/sign-in/email/start', EmailStartSchema, SignInEmailSchema.parse({ email })),
  confirmEmailLink: (email: string, code: string) =>
    request(
      '/v1/sign-in/email/confirm',
      EmailSubjectSchema,
      SignInEmailCodeSchema.parse({ email, code }),
    ),
  startEmailLogin: (email: string) =>
    request('/v1/sign-in/email/login/start', z.strictObject({ delivery: z.literal('sent') }), {
      email,
    }),
  loginWithEmail: (email: string, code: string) =>
    request('/v1/sign-in/email/login', SessionSchema, SignInEmailCodeSchema.parse({ email, code })),
  linkTelegram: (proof: string) =>
    request(
      '/v1/sign-in/telegram',
      z.strictObject({ provider: z.literal('telegram'), subject: z.string() }),
      { proof },
    ),
  loginWithTelegram: (proof: string) =>
    request('/v1/sign-in/telegram/login', SessionSchema, SignInProofSchema.parse({ proof })),
  passkeyRegisterOptions: () =>
    request('/v1/sign-in/passkey/register/options', PasskeyRegisterOptionsSchema, {}),
  registerPasskey: (input: z.infer<typeof SignInPasskeyRegisterSchema>) =>
    request(
      '/v1/sign-in/passkey/register',
      PasskeyRegisteredSchema,
      SignInPasskeyRegisterSchema.parse(input),
    ),
  passkeyLoginOptions: () =>
    request('/v1/sign-in/passkey/login/options', PasskeyLoginOptionsSchema, {}),
  loginWithPasskey: (input: z.infer<typeof SignInPasskeyLoginSchema>) =>
    request('/v1/sign-in/passkey/login', SessionSchema, SignInPasskeyLoginSchema.parse(input)),
  removeSignIn: (method: 'telegram' | 'email' | 'passkey', subject: string) =>
    request('/v1/sign-in/remove', z.null(), SignInRemoveSchema.parse({ method, subject })),
  evmLinks: () => request('/v1/account/evm', EvmLinksSchema),
  evmSignInChallenge: (purpose: 'login' | 'pair', chainId: 40 | 41, address: string) =>
    request(
      '/v1/account/evm/sign-in/challenge',
      EvmSignInChallengeSchema,
      EvmIntentSchema.parse({ purpose, chainId, address }),
    ),
  pairEvm: (id: string, signature: string) =>
    request(
      '/v1/account/evm/sign-in/link',
      EvmLinkSchema,
      EvmFinishSchema.parse({ id, signature }),
    ),
  loginEvm: (id: string, signature: string) =>
    request('/v1/sign-in/evm', SessionSchema, EvmFinishSchema.parse({ id, signature })),
  evmBinding: (dao: string, member: string) =>
    request(
      `/v1/daos/${IdSchema.parse(dao)}/evm/${IdSchema.parse(member)}`,
      EvmGovernanceBindingSchema,
    ),
  relayEvm: (input: EvmRelay) =>
    request('/v1/relay/evm', ApiRoutes.relay.response, EvmRelaySchema.parse(input)),
  unlinkEvm: (chainId: 40 | 41) => request('/v1/account/evm/unlink', z.null(), { chainId }),
  marketplace: () => request('/v1/marketplace', MarketplaceSchema),
  names: () => request('/v1/names', NamesServiceSchema),
  nameQuote: (accountName: string) =>
    request(`/v1/names/quote?name=${encodeURIComponent(accountName)}`, NameQuoteSchema),
  nameCheckout: (input: { accountName: string; ownerKey: string; activeKey: string }) =>
    request('/v1/names/checkout', ServiceCheckoutSchema, input),
  docsAgent: () => request('/v1/docs/agent', DocsAgentStatusSchema),
  askDocs: (question: string) => request('/v1/docs/ask', DocsAnswerSchema, { question }, 20000),
  logout: async () => {
    await request(ApiRoutes.logout.path, ApiRoutes.logout.response, {});
    sessionStorage.removeItem(csrfStorageKey());
  },
};
export function friendlyError(error: unknown): string {
  if (error instanceof ApiFailure) {
    const messages: Record<string, string> = {
      ...ContractFailureMessages,
      ASSET_UNAVAILABLE:
        'The token contract, symbol or precision is not available on this chain. Correct the treasury asset before preparing payment.',
      RESPONSE_INVALID:
        'The service returned an incompatible response. Refresh after the operator verifies its version.',
      CREATION_RATE_UNAVAILABLE:
        'A fresh TLOS rate is unavailable. Try card payment or ask the operator to update the rate.',
      PRESET_MODULE_UNAVAILABLE:
        'This setup requires verified, registered modules that are unavailable on this deployment.',
      CREATION_PAYMENT_REQUIRED: 'Pay this setup order before creating the DAO.',
      CREATION_ORDER_UNKNOWN: 'No setup order belongs to this account with that ID.',
      CREATION_ORDER_PENDING:
        'The order response is uncertain. Resume this order before paying or starting another.',
      CREATION_ORDER_CONFLICT:
        'This order uses the original setup. Resume it or start a new unpaid order.',
      DAO_CREATION_UNAVAILABLE: 'Paid DAO creation is not configured on this deployment.',
      INDEPENDENT_UNAVAILABLE:
        'Independent deployment requires the operator kit. Checkout is not available yet.',
      CREATION_CHECKOUT_UNAVAILABLE:
        'This card order is expired or already paid. Check its status.',
      AUTH_REQUIRED: 'Sign in to continue.',
      ACCOUNT_CONTROL_REQUIRED:
        'Prove control with your Daclify keys or an authorized linked wallet before changing sign-in methods.',
      VAULT_IDENTITY_REQUIRED:
        'Set up or restore your Daclify keys before creating a DAO. Wallet recovery alone does not restore document decryption keys.',
      LAST_CONTROL_CREDENTIAL:
        'Pair another blockchain wallet before removing your last account-control method.',
      WALLET_MEMBERSHIP_CONFLICT:
        'Your credentials point to different members in this DAO. Use a separate account for each member.',
      VAULT_ALREADY_REGISTERED:
        'These keys belong to an existing service account. Sign out and sign in with that vault; accounts are not merged automatically.',
      VAULT_ALREADY_CONFIGURED:
        'This account already has Daclify keys. Unlock its original vault instead.',
      VAULT_PROOF_INVALID:
        'The key setup proof expired or was rejected. Unlock your vault and try again.',
      AUTH_INVALID: 'The login proof expired or was already used. Try again.',
      KEY_CHANGE_REQUIRED:
        'This account uses a different encryption key. Use its original recovery kit.',
      CSRF_REQUIRED: 'Refresh your session by signing in again.',
      CHAIN_ACTION_REJECTED:
        'The contract rejected the action. Refresh the DAO and check your permissions.',
      CHAIN_UNAVAILABLE: 'The blockchain node is unavailable. Try again later.',
      ARCHIVE_ADMIN_REQUIRED: 'Only an active DAO administrator can manage its archive.',
      ARCHIVE_PLAN_CHANGED:
        'The selected rows or storage estimate changed. Preview and approve the export again.',
      ARCHIVE_REQUEST_CONFLICT:
        'This export request was already used for different details. Preview again before creating a new request.',
      ARCHIVE_NOT_ELIGIBLE: 'Every selected poll must be eligible before exporting.',
      ARCHIVE_BACKUP_NOT_CONFIGURED:
        'The operator has not configured an independent encrypted backup store.',
      ARCHIVE_BACKUP_UNAVAILABLE:
        'The encrypted backup could not be verified. Its receipt was not changed. Ask the operator to check backup storage and keys.',
      ARCHIVE_BACKUP_CONFLICT:
        'This export already has a different immutable backup receipt. Operator review is required.',
      ARCHIVE_MANIFEST_CHANGED: 'The manifest changed. Reload the export before creating a backup.',
      ARCHIVE_NOT_READY: 'The recovery bundle is still being verified. Refresh its export status.',
      ARCHIVE_NOT_FOUND: 'This export could not be found on the selected operator.',
      ARCHIVE_BUNDLE_UNAVAILABLE:
        'The recovery bundle could not be retrieved or verified. Keep your existing backup and try again.',
      ARCHIVE_UNAVAILABLE: 'Archive preview is not configured on this operator.',
      RESOURCE_UNAVAILABLE: 'RAM reporting is not configured on this operator.',
      RESOURCE_UNQUALIFIED: 'This deployment does not match the qualified RAM accounting code.',
      RESOURCE_SCOPE_LIMIT:
        'The RAM report exceeded its complete-read bound. Ask the operator to review the deployment.',
      RESOURCE_SOURCE_CHANGED: 'A contract changed during the RAM read. Refresh the report.',
      ARCHIVE_SCHEMA_UNSUPPORTED:
        'The deployed contract or archive schema is not qualified for this preview.',
      ARCHIVE_SNAPSHOT_UNQUALIFIED:
        'A verified irreversible snapshot is unavailable. Try again after chain confirmation.',
      ARCHIVE_COVERAGE_INCOMPLETE:
        'Complete archive coverage could not be verified. Use a smaller selection or contact the operator.',
      ARCHIVE_SOURCE_INVALID:
        'The archive source did not pass eligibility or integrity checks. No records were changed.',
      CUSTODY_POLICY: 'This DAO requires user-controlled keys.',
      RESULT_LIMIT:
        'This deployment exceeds the current read limit. Configure an indexed read service.',
      STORAGE_UNCONFIGURED: 'Hosted storage is not configured on this service.',
      STRIPE_NOT_CONFIGURED: 'Card payments are not configured on this service.',
      NAMES_UNCONFIGURED: 'The Telos nameservice is not on this chain yet.',
      CARD_UNAVAILABLE: 'This name has no card price on chain.',
      NAME_TAKEN: 'That Telos account already exists.',
      NAME_SOLD: 'That name has already been sold.',
      NAME_PRICE: 'The card amount does not match the on-chain price.',
      TIER_UNSET: 'That name tier is not set on chain.',
      FEE_UNSET: 'Nameservice fees are not set on this chain yet.',
      FEE_RULE: 'That listing does not accept the platform fee rule.',
      SUFFIX: 'Connect the suffix account before this name can be sold.',
      CHECKOUT_URL: 'The card checkout address was not accepted.',
      AUTH_AUDIENCE:
        'The signing challenge does not match this app and selected API. Stop and verify the operator connection.',
      OPERATOR_DAO: 'Return to the Hub and explicitly connect to the DAO you want to use.',
      OPERATOR_INCOMPATIBLE:
        'This operator does not match the registered DAO and the app’s reviewed release.',
      OPERATOR_UNAVAILABLE:
        'The operator API could not be verified. Check its HTTPS endpoint and allowed frontend origins.',
      STORAGE_QUOTA: 'The DAO storage allowance is full. Existing documents remain available.',
      STORAGE_OWNERSHIP_REVIEW: 'The storage operator must verify this file’s provider ownership.',
      STORAGE_OBJECT_REVIEW:
        'This stored file requires operator review before another reference can be added.',
      UPLOAD_PENDING:
        'Upload completion is uncertain. Keep the request ID and check completion before starting another upload.',
      UPLOAD_REQUEST_CONFLICT:
        'This request ID belongs to different file data. Resume its original upload.',
      UPLOAD_UNKNOWN: 'No upload record was found for this request and account.',
      UPLOAD_FAILED: 'This upload requires operator review.',
      MEMBER_REQUIRED: 'An active DAO membership is required for this action.',
      PROFILE_FIELD: 'The stored profile uses a field this form does not edit.',
      PROVIDER_UNCONFIGURED: 'Telegram is not configured on this server.',
      PROVIDER_INVALID: 'The login proof was rejected.',
      PROVIDER_REPLAY: 'That login proof was already used. Try again.',
      PROVIDER_UNKNOWN: 'That sign-in method is not paired with an account.',
      EMAIL_UNAVAILABLE: 'Email delivery is not configured on this server.',
      EMAIL_DELIVERY_FAILED: 'The email could not be sent. Try again or use another paired method.',
      EMAIL_INVALID: 'That email code is not valid anymore.',
      CREDENTIAL_LINKED: 'That sign-in method is already paired with another account.',
      CREDENTIAL_UNKNOWN: 'That sign-in method is not paired with this account.',
      PASSKEY_INVALID: 'The passkey could not be verified. Try again.',
      PASSKEY_LINKED: 'That passkey is already paired with an account.',
      PASSKEY_LIMIT: 'This account already has the maximum number of passkeys.',
      RATE_LIMIT: 'Too many requests. Wait a moment and try again.',
      DOCS_AGENT_UNAVAILABLE: 'The documentation assistant is not configured on this server.',
      DOCS_AGENT_FAILED: 'The documentation assistant could not answer. Try again.',
      EVM_SIGNATURE_INVALID: 'The Telos EVM signature was rejected.',
      EVM_CHALLENGE_INVALID: 'The Telos EVM link expired. Try again.',
      EVM_LINKED: 'That Telos EVM address is already linked to another account.',
      EVM_UNKNOWN: 'That Telos EVM address is not linked to this account.',
      DOCUMENT_VERSION:
        'This document version is already in use. Refresh the DAO before preparing another version.',
    };
    return messages[error.code] ?? 'The service could not complete the request.';
  }
  if (error instanceof Error) {
    const cryptoErrors: Record<string, string> = {
      WALLET_CONTEXT_CHANGED:
        'The account, wallet, network or page changed. Review the current action and sign again.',
      NATIVE_UNLINKED: 'Authorize this native wallet for the DAO member before signing.',
      NATIVE_WALLET_MISSING: 'Connect your Telos Zero wallet before signing.',
      EVM_WALLET_MISSING: 'Connect your Telos EVM wallet before signing.',
      NATIVE_AUTHORITY_UNSUPPORTED: 'Use an active permission with supported direct signing keys.',
      MANAGED_UNAVAILABLE: 'Managed admission is not available on this deployment.',
      PARTICIPANT_MODE: 'This participant kind does not match the DAO admission policy.',
      VAULT_LOCKED: 'Unlock your vault to use your keys.',
      EPOCH_UNAVAILABLE: 'Ask a DAO administrator for a key grant for this epoch.',
      EPOCH_KEY_MISMATCH:
        'The key grant does not match the DAO epoch. Ask an administrator to resolve it.',
      DOCUMENT_INTEGRITY: 'The document failed its integrity check and was not opened.',
      FILE_EMPTY: 'Choose a file that contains data.',
      FILE_REQUIRED: 'Choose a document file.',
      FILE_TOO_LARGE:
        'The stored file exceeds 5 MiB. Private file encryption and encoding reduce the maximum original size.',
      FILE_METADATA: 'The filename or media type is not supported.',
      UPLOAD_RECEIPT: 'The upload receipt does not match this DAO or file request.',
      MEMBER_REQUIRED: 'An active DAO membership is required for this action.',
      DOCUMENT_VERSION:
        'This document version is already in use. Refresh before preparing another version.',
      PAYROLL_START: 'Choose a future UTC start time and submit before it is due.',
      AMOUNT_REQUIRED: 'Enter a positive token amount.',
      INSUFFICIENT_EXIT_BALANCE: 'The amount exceeds the selected claim or stake balance.',
      PAYOUT_DESTINATION: 'Choose an existing native account other than this runtime.',
      CHECKOUT_URL: 'The card checkout address was not accepted.',
      AUTH_AUDIENCE:
        'The signing challenge does not match this app and selected API. Stop and verify the operator connection.',
      OPERATOR_DAO: 'Return to the Hub and explicitly connect to the DAO you want to use.',
      OPERATOR_INCOMPATIBLE:
        'This operator does not match the registered DAO and the app’s reviewed release.',
      OPERATOR_UNAVAILABLE:
        'The operator API could not be verified. Check its HTTPS endpoint and allowed frontend origins.',
      DAO_REFERENCE: 'The account and DAO deployment references do not match.',
    };
    const cryptoMessage = cryptoErrors[error.message];
    if (cryptoMessage) return cryptoMessage;
  }
  if (error instanceof Error && error.message === 'VAULT_UNLOCK_FAILED')
    return 'The vault could not be unlocked. Check your password or recovery kit.';
  return 'The request could not be completed. Check your connection and try again.';
}
