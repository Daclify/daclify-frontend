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
  createDao: (metadata: z.infer<typeof MetadataSchema>, privacy: Privacy, token: AssetRef) =>
    request(ApiRoutes.createDao.path, ApiRoutes.createDao.response, { metadata, privacy, token }),
  relay: (requestData: instruction, sig: string) =>
    request(ApiRoutes.relay.path, ApiRoutes.relay.response, { request: requestData, sig }),
  serviceCheckout: () => request('/v1/billing/checkout', ServiceCheckoutSchema, {}),
  serviceReceipts: () => request('/v1/billing/receipts', ServiceReceiptsSchema),
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
