import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { ModuleApiRoutes, VERSION as MODULE_VERSION, type ModuleState } from '@daclify/modules';
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
import { csrfStorageKey, resolveApiUrl } from './networks';
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
  return schema.parse(body);
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
  storage: () => request(ApiRoutes.storage.path, ApiRoutes.storage.response),
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
    return page.daos;
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
  memberships: async (): Promise<UserMembership[]> =>
    (await request(ApiRoutes.memberships.path, ApiRoutes.memberships.response)).memberships,
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
      AUTH_INVALID: 'The login proof expired or was already used. Try again.',
      KEY_CHANGE_REQUIRED:
        'This account uses a different encryption key. Use its original recovery kit.',
      CSRF_REQUIRED: 'Refresh your session by signing in again.',
      CHAIN_ACTION_REJECTED:
        'The contract rejected the action. Refresh the DAO and check your permissions.',
      CHAIN_UNAVAILABLE: 'The blockchain node is unavailable. Try again later.',
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
      STORAGE_QUOTA: 'The DAO storage allowance is full. Existing documents remain available.',
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
      DAO_REFERENCE: 'The account and DAO deployment references do not match.',
    };
    const cryptoMessage = cryptoErrors[error.message];
    if (cryptoMessage) return cryptoMessage;
  }
  if (error instanceof Error && error.message === 'VAULT_UNLOCK_FAILED')
    return 'The vault could not be unlocked. Check your password or recovery kit.';
  return 'The request could not be completed. Check your connection and try again.';
}
