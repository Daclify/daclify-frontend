import { ModuleApiRoutes } from '@daclify/modules';
import { z } from 'zod';
import {
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
  type MetadataSchema,
  SessionSchema,
  type Privacy,
  type AssetRef,
} from '@daclify/core-protocol';
import type { instruction } from '@daclify/core-protocol/sdk';
import { csrfStorageKey, resolveApiUrl } from './networks';
export class ApiFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const ServiceCheckoutSchema = z.strictObject({ url: z.url() });
const ServiceReceiptSchema = z.strictObject({
  status: z.enum(['paid', 'failed']),
  currency: z
    .string()
    .regex(/^[a-z]{3}$/)
    .nullable(),
  amountMinor: z.number().int().nonnegative().nullable(),
  paymentStatus: z.string().min(1),
});
const ServiceReceiptsSchema = z.strictObject({ receipts: z.array(ServiceReceiptSchema) });
const MemberProfileSchema = z.strictObject({
  accountName: z.string().nullable(),
  profile: z.string().nullable(),
});
const SignInDeliverySchema = z.enum(['local', 'mail', 'unavailable']);
const SignInOptionsSchema = z.strictObject({
  telegram: z.strictObject({ configured: z.boolean(), username: z.string().nullable() }),
  email: z.strictObject({ delivery: SignInDeliverySchema }),
  passkey: z.strictObject({ rpId: z.string().min(1) }),
});
const SignInMethodsSchema = z.strictObject({
  telegram: z.strictObject({
    configured: z.boolean(),
    username: z.string().nullable(),
    subjects: z.array(z.string()),
  }),
  email: z.strictObject({ delivery: SignInDeliverySchema, subjects: z.array(z.string()) }),
  passkeys: z.array(z.strictObject({ id: z.string().min(1) })),
});
const EmailStartSchema = z.union([
  z.strictObject({ delivery: z.literal('local'), code: z.string().regex(/^\d{8}$/) }),
  z.strictObject({ delivery: z.literal('sent') }),
]);
const EmailSubjectSchema = z.strictObject({ subject: z.string().min(1) });
const PasskeyRegisterOptionsSchema = z.strictObject({
  challenge: z.string().regex(/^[A-Za-z0-9_-]+$/),
  rp: z.strictObject({ name: z.string(), id: z.string() }),
  user: z.strictObject({ id: z.string(), name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.strictObject({ type: z.literal('public-key'), alg: z.literal(-7) })),
  timeout: z.number().int().positive(),
  attestation: z.literal('none'),
  authenticatorSelection: z.strictObject({
    residentKey: z.literal('required'),
    requireResidentKey: z.literal(true),
    userVerification: z.literal('required'),
  }),
  excludeCredentials: z.array(z.strictObject({ type: z.literal('public-key'), id: z.string() })),
});
const PasskeyLoginOptionsSchema = z.strictObject({
  challenge: z.string().regex(/^[A-Za-z0-9_-]+$/),
  timeout: z.number().int().positive(),
  rpId: z.string().min(1),
  userVerification: z.literal('required'),
});
const PasskeyRegisteredSchema = z.strictObject({ id: z.string().min(1) });
const TelosChainSchema = z.union([z.literal(40), z.literal(41)]);
const EvmLinkSchema = z.strictObject({
  chainId: TelosChainSchema,
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
const EvmLinksSchema = z.strictObject({ links: z.array(EvmLinkSchema) });
const EvmChallengeSchema = z.strictObject({
  chainId: TelosChainSchema,
  message: z.string().min(1),
  expiresAt: z.string().min(1),
});
const DocsAgentStatusSchema = z.strictObject({ configured: z.boolean() });
const DocsAnswerSchema = z.strictObject({
  status: z.enum(['answered', 'outside']),
  topicId: z.string().nullable(),
  title: z.string().nullable(),
  answer: z.string(),
});
export type SignInOptions = z.infer<typeof SignInOptionsSchema>;
export type SignInMethods = z.infer<typeof SignInMethodsSchema>;
export type PasskeyRegisterOptions = z.infer<typeof PasskeyRegisterOptionsSchema>;
export type PasskeyLoginOptions = z.infer<typeof PasskeyLoginOptionsSchema>;
export type ServiceReceipt = z.infer<typeof ServiceReceiptSchema>;
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  input?: unknown,
  timeoutMs = 15000,
): Promise<T> {
  const csrf = sessionStorage.getItem(csrfStorageKey()) ?? '';
  const response = await fetch(resolveApiUrl(path), {
    method: input === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: {
      ...(input === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf }),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = ErrorSchema.safeParse(body);
    throw new ApiFailure(error.success ? error.data.code : 'SERVICE_UNAVAILABLE');
  }
  return schema.parse(body);
}
export const api = {
  content: (daoId: string) =>
    request(
      ApiRoutes.content.path.replace(':id', IdSchema.parse(daoId)),
      ApiRoutes.content.response,
    ),
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
  moduleState: (daoId: string) =>
    request(
      ModuleApiRoutes.state.path.replace(':id', IdSchema.parse(daoId)),
      ModuleApiRoutes.state.response,
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
  daos: async (): Promise<DaoSummary[]> =>
    (await request(ApiRoutes.daos.path, ApiRoutes.daos.response)).daos,
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
  createDao: (metadata: z.infer<typeof MetadataSchema>, privacy: Privacy, token: AssetRef) =>
    request(ApiRoutes.createDao.path, ApiRoutes.createDao.response, { metadata, privacy, token }),
  relay: (requestData: instruction, sig: string) =>
    request(ApiRoutes.relay.path, ApiRoutes.relay.response, { request: requestData, sig }),
  serviceCheckout: () => request('/v1/billing/checkout', ServiceCheckoutSchema, {}),
  serviceReceipts: () => request('/v1/billing/receipts', ServiceReceiptsSchema),
  signInOptions: () => request('/v1/sign-in/options', SignInOptionsSchema),
  signInMethods: () => request('/v1/sign-in/methods', SignInMethodsSchema),
  startEmailLink: (email: string) =>
    request('/v1/sign-in/email/start', EmailStartSchema, { email }),
  confirmEmailLink: (email: string, code: string) =>
    request('/v1/sign-in/email/confirm', EmailSubjectSchema, { email, code }),
  startEmailLogin: (email: string) =>
    request('/v1/sign-in/email/login/start', z.strictObject({ delivery: z.literal('sent') }), {
      email,
    }),
  loginWithEmail: (email: string, code: string) =>
    request('/v1/sign-in/email/login', SessionSchema, { email, code }),
  linkTelegram: (proof: string) =>
    request(
      '/v1/sign-in/telegram',
      z.strictObject({ provider: z.literal('telegram'), subject: z.string() }),
      { proof },
    ),
  loginWithTelegram: (proof: string) =>
    request('/v1/sign-in/telegram/login', SessionSchema, { proof }),
  passkeyRegisterOptions: () =>
    request('/v1/sign-in/passkey/register/options', PasskeyRegisterOptionsSchema, {}),
  registerPasskey: (input: { clientDataJSON: string; attestationObject: string }) =>
    request('/v1/sign-in/passkey/register', PasskeyRegisteredSchema, input),
  passkeyLoginOptions: () =>
    request('/v1/sign-in/passkey/login/options', PasskeyLoginOptionsSchema, {}),
  loginWithPasskey: (input: {
    credentialId: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
  }) => request('/v1/sign-in/passkey/login', SessionSchema, input),
  removeSignIn: (method: 'telegram' | 'email' | 'passkey', subject: string) =>
    request('/v1/sign-in/remove', z.null(), { method, subject }),
  evmLinks: () => request('/v1/account/evm', EvmLinksSchema),
  evmChallenge: (chainId: 40 | 41) =>
    request('/v1/account/evm/challenge', EvmChallengeSchema, { chainId }),
  linkEvm: (input: { chainId: 40 | 41; address: string; signature: string }) =>
    request('/v1/account/evm/link', EvmLinkSchema, input),
  unlinkEvm: (chainId: 40 | 41) => request('/v1/account/evm/unlink', z.null(), { chainId }),
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
      AUTH_REQUIRED: 'Sign in to continue.',
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
