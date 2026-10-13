import {
  AccountExitRoutes,
  ExitNativeStepRoute,
  type ExitIntent,
  SignedExitInstructionSchema,
  ExitSettlementRoutes,
  type ExitSubmission,
} from '@daclify/core-protocol';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { ModuleApiRoutes, CONTRACT_VERSION, type ModuleState } from '@daclify/modules';
import { ArchiveRoutes } from '@daclify/modules/archive';
import { z } from 'zod';
import {
  TelosGovernanceRoutes,
  TelosVoteInputSchema,
  type TelosVoteInput,
  type TelosBallotKind,
} from '@daclify/modules';
import {
  PeopleRoutes,
  ContentPageQuerySchema,
  type ContentPageQuery,
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
  NamesInventoryQuerySchema,
  type NamesInventoryQuery,
  NameQuoteSchema,
  DocsAgentStatusSchema,
  DocsAnswerSchema,
  ContractFailureMessages,
  ApiRoutes,
  IdSchema,
  daoPaymentKey,
  HostedUploadSchema,
  HostedIntentSchema,
  BrandingUploadSchema,
  type BrandingUpload,
  ErrorSchema,
  type HostedUpload,
  type Account,
  type DaoSummary,
  type Network,
  type UserMembership,
  SessionSchema,
  AccountControlPaths,
  ProfileContextSchema,
  profileCipherDomain,
  type ProfileContext,
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
  RecoveryRoutes,
  SignupRoutes,
  RecoveryGrantSchema,
  MiniAppsRoutes,
} from '@daclify/core-protocol';
import type { instruction } from '@daclify/core-protocol/sdk';
import {
  csrfStorageKey,
  resolveApiUrl,
  currentOperator,
  assertOperatorDao,
  matchesDeployment,
} from './networks';
import { AuthChallengePaths, validateAuthChallenge } from '../auth/audience';
import {
  HostingRoutes,
  ModuleFeeRoutes,
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
let recoveryGrant: { token: string; accountId: string; scope: string; expires: number } | undefined;
export function takeRecoveryGrant(accountId: string): string | undefined {
  const grant = recoveryGrant;
  recoveryGrant = undefined;
  if (
    !grant ||
    grant.accountId !== accountId ||
    grant.scope !== resolveApiUrl('/') ||
    grant.expires <= Date.now()
  )
    return undefined;
  return grant.token;
}
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
  if (path === ApiRoutes.network.path) {
    const network = ApiRoutes.network.response.parse(result);
    if (!matchesDeployment(network)) throw new ApiFailure('NETWORK_MISMATCH');
    if (
      operator &&
      (network.chainId !== operator.reference.chainId ||
        network.runtime !== operator.reference.contract)
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
  const login = SessionSchema.safeParse(result);
  if (login.success) {
    const token = RecoveryGrantSchema.safeParse(response.headers.get('x-daclify-recovery-grant'));
    recoveryGrant = token.success
      ? {
          token: token.data,
          accountId: login.data.account.id,
          scope: resolveApiUrl('/'),
          expires: Date.now() + 300000,
        }
      : undefined;
  }
  return result;
}
export function verifiedModuleRelease(state: ModuleState): ModuleState {
  return {
    ...state,
    modules: state.modules.map((module) => ({
      ...module,
      compatible: module.compatible && module.deployment.version === CONTRACT_VERSION,
      codeVerified:
        module.codeVerified &&
        module.deployment.codeHash === ModuleCodeHashes[module.deployment.id],
    })),
  };
}
export const api = {
  clearGoverningDocuments: (input: z.infer<typeof ModuleApiRoutes.clearDocuments.input>) =>
    request(
      ModuleApiRoutes.clearDocuments.path,
      ModuleApiRoutes.clearDocuments.response,
      ModuleApiRoutes.clearDocuments.input.parse(input),
    ),
  governingDocuments: async (
    daoId: string,
    query: z.infer<typeof ModuleApiRoutes.documents.query> = {},
  ) => {
    const id = IdSchema.parse(daoId);
    const page = await request(
      ModuleApiRoutes.documents.path.replace(':id', id) +
        '?' +
        new URLSearchParams(
          Object.entries(ModuleApiRoutes.documents.query.parse(query)).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, value]],
          ),
        ).toString(),
      ModuleApiRoutes.documents.response,
    );
    if (page.dao.daoId !== id) throw new ApiFailure('DAO_REFERENCE');
    const module = page.module;
    return {
      ...page,
      available:
        page.available &&
        !!module &&
        module.installed &&
        module.compatible &&
        module.codeVerified &&
        module.deployment.version === CONTRACT_VERSION &&
        module.deployment.codeHash === ModuleCodeHashes.decide,
    };
  },
  appSourceAccess: (id: string) =>
    request(
      ApiRoutes.appSourceAccess.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.appSourceAccess.response,
      {},
    ),
  signupOptions: () =>
    request(SignupRoutes.signupOptions.path, SignupRoutes.signupOptions.response),
  signupEmailStart: (email: string) =>
    request(
      SignupRoutes.signupEmailStart.path,
      SignupRoutes.signupEmailStart.response,
      SignupRoutes.signupEmailStart.input.parse({ email }),
    ),
  signupEmailVerify: (email: string, code: string) =>
    request(
      SignupRoutes.signupEmailVerify.path,
      SignupRoutes.signupEmailVerify.response,
      SignupRoutes.signupEmailVerify.input.parse({ email, code }),
    ),
  signupTelegram: (proof: string) =>
    request(
      SignupRoutes.signupTelegramVerify.path,
      SignupRoutes.signupTelegramVerify.response,
      SignupRoutes.signupTelegramVerify.input.parse({ proof }),
    ),
  startSignupTelegram: (returnTo?: string) =>
    request(
      SignupRoutes.signupTelegramStart.path,
      SignupRoutes.signupTelegramStart.response,
      SignupRoutes.signupTelegramStart.input.parse(returnTo ? { returnTo } : {}),
    ),
  signupPending: (id: string) =>
    request(
      SignupRoutes.signupPending.path.replace(':id', z.uuid().parse(id)),
      SignupRoutes.signupPending.response,
    ),
  signupPrepare: (input: z.infer<typeof SignupRoutes.signupPrepare.input>) =>
    request(
      SignupRoutes.signupPrepare.path,
      SignupRoutes.signupPrepare.response,
      SignupRoutes.signupPrepare.input.parse(input),
    ),
  signupAuthorize: (input: z.infer<typeof SignupRoutes.signupAuthorize.input>) =>
    request(
      SignupRoutes.signupAuthorize.path,
      SignupRoutes.signupAuthorize.response,
      SignupRoutes.signupAuthorize.input.parse(input),
    ),
  signupFinish: (input: z.infer<typeof SignupRoutes.signupFinish.input>) =>
    request(
      SignupRoutes.signupFinish.path,
      SignupRoutes.signupFinish.response,
      SignupRoutes.signupFinish.input.parse(input),
    ),
  optOutAssisted: (input: z.infer<typeof RecoveryRoutes.recoveryOptOut.input>) =>
    request(
      RecoveryRoutes.recoveryOptOut.path,
      RecoveryRoutes.recoveryOptOut.response,
      RecoveryRoutes.recoveryOptOut.input.parse(input),
    ),
  recoveryAssistedRevision: () =>
    request(
      RecoveryRoutes.recoveryAssistedRevision.path,
      RecoveryRoutes.recoveryAssistedRevision.response,
    ),
  connectedApps: (daoId: string) =>
    request(
      ApiRoutes.connectedApps.path.replace(':id', IdSchema.parse(daoId)),
      ApiRoutes.connectedApps.response,
    ),
  miniAppConnection: (daoId: string, appId: string) =>
    request(
      MiniAppsRoutes.miniAppConnection.path
        .replace(':daoId', IdSchema.parse(daoId))
        .replace(':appId', IdSchema.parse(appId)),
      MiniAppsRoutes.miniAppConnection.response,
    ),
  checkMiniAppConnection: (daoId: string, appId: string) =>
    request(
      MiniAppsRoutes.checkMiniAppConnection.path
        .replace(':daoId', IdSchema.parse(daoId))
        .replace(':appId', IdSchema.parse(appId)),
      MiniAppsRoutes.checkMiniAppConnection.response,
      {},
    ),
  stageConnectedApp: (input: z.infer<typeof ApiRoutes.stageConnectedApp.input>) =>
    request(
      ApiRoutes.stageConnectedApp.path,
      ApiRoutes.stageConnectedApp.response,
      ApiRoutes.stageConnectedApp.input.parse(input),
    ),
  mcpRelease: () => request(ApiRoutes.mcpRelease.path, ApiRoutes.mcpRelease.response),
  mcpConnections: () => request(ApiRoutes.mcpConnections.path, ApiRoutes.mcpConnections.response),
  mcpRevokeFamily: (id: string) =>
    request(ApiRoutes.mcpRevokeFamily.path, ApiRoutes.mcpRevokeFamily.response, {
      id: z.uuid().parse(id),
    }),
  mcpOAuthConsent: (id: string) =>
    request(
      ApiRoutes.mcpOAuthConsent.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.mcpOAuthConsent.response,
    ),
  mcpOAuthApprove: (input: z.infer<typeof ApiRoutes.mcpOAuthApprove.input>) =>
    request(
      ApiRoutes.mcpOAuthApprove.path,
      ApiRoutes.mcpOAuthApprove.response,
      ApiRoutes.mcpOAuthApprove.input.parse(input),
    ),
  mcpGrants: () => request(ApiRoutes.mcpGrants.path, ApiRoutes.mcpGrants.response),
  mcpRevokeGrant: (id: string) =>
    request(ApiRoutes.mcpRevokeGrant.path, ApiRoutes.mcpRevokeGrant.response, {
      id: z.uuid().parse(id),
    }),
  mcpConsent: (id: string) =>
    request(
      ApiRoutes.mcpConsent.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.mcpConsent.response,
    ),
  mcpApprove: (input: z.infer<typeof ApiRoutes.mcpApprove.input>) =>
    request(
      ApiRoutes.mcpApprove.path,
      ApiRoutes.mcpApprove.response,
      ApiRoutes.mcpApprove.input.parse(input),
    ),
  appConsent: (id: string) =>
    request(
      ApiRoutes.appConsent.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.appConsent.response,
    ),
  approveApp: (id: string, sessionId?: string) =>
    request(
      ApiRoutes.approveApp.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.approveApp.response,
      ApiRoutes.approveApp.input.parse(sessionId ? { sessionId } : {}),
    ),
  rejectApp: (id: string) =>
    request(
      ApiRoutes.rejectApp.path.replace(':id', z.uuid().parse(id)),
      ApiRoutes.rejectApp.response,
      {},
    ),
  appKeys: (daoId: string, appId: string) =>
    request(
      ModuleApiRoutes.appKeys.path
        .replace(':id', IdSchema.parse(daoId))
        .replace(':appId', IdSchema.parse(appId)),
      ModuleApiRoutes.appKeys.response,
    ),
  beginDeviceRecovery: (input: z.infer<typeof RecoveryRoutes.deviceRecoveryBegin.input>) =>
    request(
      RecoveryRoutes.deviceRecoveryBegin.path,
      RecoveryRoutes.deviceRecoveryBegin.response,
      RecoveryRoutes.deviceRecoveryBegin.input.parse(input),
    ),
  deviceRecoveryRequest: (id: string) =>
    request(
      '/v1/account/recovery/device/' + z.uuid().parse(id),
      RecoveryRoutes.deviceRecoveryRequest.response,
    ),
  approveDeviceRecovery: (input: z.infer<typeof RecoveryRoutes.deviceRecoveryApprove.input>) =>
    request(
      RecoveryRoutes.deviceRecoveryApprove.path,
      RecoveryRoutes.deviceRecoveryApprove.response,
      RecoveryRoutes.deviceRecoveryApprove.input.parse(input),
    ),
  pollDeviceRecovery: (input: z.infer<typeof RecoveryRoutes.deviceRecoveryPoll.input>) =>
    request(
      RecoveryRoutes.deviceRecoveryPoll.path,
      RecoveryRoutes.deviceRecoveryPoll.response,
      RecoveryRoutes.deviceRecoveryPoll.input.parse(input),
    ),
  cancelDeviceRecovery: (input: z.infer<typeof RecoveryRoutes.deviceRecoveryCancel.input>) =>
    request(
      RecoveryRoutes.deviceRecoveryCancel.path,
      RecoveryRoutes.deviceRecoveryCancel.response,
      RecoveryRoutes.deviceRecoveryCancel.input.parse(input),
    ),
  recoveryMethods: () =>
    request(RecoveryRoutes.recoveryMethods.path, RecoveryRoutes.recoveryMethods.response),
  enableRecovery: (input: z.infer<typeof RecoveryRoutes.recoveryEnroll.input>) =>
    request(
      RecoveryRoutes.recoveryEnroll.path,
      RecoveryRoutes.recoveryEnroll.response,
      RecoveryRoutes.recoveryEnroll.input.parse(input),
      45000,
    ),
  disableRecovery: (input: z.infer<typeof RecoveryRoutes.recoveryDisable.input>) =>
    request(
      RecoveryRoutes.recoveryDisable.path,
      RecoveryRoutes.recoveryDisable.response,
      RecoveryRoutes.recoveryDisable.input.parse(input),
    ),
  recoveryAssistedOptions: (input: z.infer<typeof RecoveryRoutes.recoveryAssistedOptions.input>) =>
    request(
      RecoveryRoutes.recoveryAssistedOptions.path,
      RecoveryRoutes.recoveryAssistedOptions.response,
      RecoveryRoutes.recoveryAssistedOptions.input.parse(input),
    ),
  claimRecovery: (input: z.infer<typeof RecoveryRoutes.recoveryClaim.input>) =>
    request(
      RecoveryRoutes.recoveryClaim.path,
      RecoveryRoutes.recoveryClaim.response,
      RecoveryRoutes.recoveryClaim.input.parse(input),
      45000,
    ),
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
  moduleFeePricing: () =>
    request(ModuleFeeRoutes.moduleFeePricing.path, ModuleFeeRoutes.moduleFeePricing.response),
  moduleFeeStatus: async (dao: DaoRef) => {
    const value = await request(
      ModuleFeeRoutes.moduleFeeStatus.path + '?dao=' + encodeURIComponent(JSON.stringify(dao)),
      ModuleFeeRoutes.moduleFeeStatus.response,
    );
    if (daoPaymentKey(value.dao) !== daoPaymentKey(dao)) throw new ApiFailure('DAO_REFERENCE');
    return value;
  },
  moduleFeeCheckout: async (input: z.infer<typeof ModuleFeeRoutes.moduleFeeCheckout.input>) => {
    const approval = ModuleFeeRoutes.moduleFeeCheckout.input.parse(input);
    const value = await request(
      ModuleFeeRoutes.moduleFeeCheckout.path,
      ModuleFeeRoutes.moduleFeeCheckout.response,
      approval,
      60000,
    );
    if (
      value.id !== approval.requestId ||
      JSON.stringify(value.approval) !== JSON.stringify(approval)
    )
      throw new ApiFailure('MODULE_ORDER_CONFLICT');
    return value;
  },
  moduleFeeOrder: async (id: string, dao: DaoRef) => {
    const value = await request(
      ModuleFeeRoutes.moduleFeeOrder.path.replace(':id', z.uuid().parse(id)),
      ModuleFeeRoutes.moduleFeeOrder.response,
      undefined,
      60000,
    );
    if (value.id !== id || daoPaymentKey(value.approval.dao) !== daoPaymentKey(dao))
      throw new ApiFailure('MODULE_ORDER_CONFLICT');
    return value;
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
  accountReconnectChallenge: (input: z.infer<typeof ApiRoutes.accountReconnectChallenge.input>) =>
    request(
      ApiRoutes.accountReconnectChallenge.path,
      ApiRoutes.accountReconnectChallenge.response,
      ApiRoutes.accountReconnectChallenge.input.parse(input),
    ),
  reconnectAccount: (id: string, signature: string) =>
    request(
      ApiRoutes.accountReconnect.path,
      ApiRoutes.accountReconnect.response,
      ApiRoutes.accountReconnect.input.parse({ id, signature }),
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
  contentPage: (daoId: string, value: ContentPageQuery = {}) => {
    const input = ContentPageQuerySchema.parse(value),
      query = new URLSearchParams();
    for (const [key, cursor] of Object.entries(input))
      if (cursor !== undefined) query.set(key, cursor);
    const path = ApiRoutes.content.path.replace(':id', IdSchema.parse(daoId));
    return request(path + (query.size ? '?' + query.toString() : ''), ApiRoutes.content.response);
  },
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
  privateAccessPolicy: (daoId: string) =>
    request(
      ApiRoutes.privateAccessPolicy.path.replace(':id', IdSchema.parse(daoId)),
      ApiRoutes.privateAccessPolicy.response,
    ),
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
  archiveHistory: async (dao: DaoRef, cursor?: string) => {
    const input = ArchiveRoutes.history.input.parse({ dao, ...(cursor ? { cursor } : {}) }),
      result = await request(
        ArchiveRoutes.history.path +
          '?dao=' +
          encodeURIComponent(JSON.stringify(input.dao)) +
          (input.cursor ? '&cursor=' + input.cursor : ''),
        ArchiveRoutes.history.response,
      );
    if (
      daoPaymentKey(result.dao) !== daoPaymentKey(dao) ||
      result.anchors.some(
        (a) =>
          a.dao_id !== dao.daoId ||
          a.manifest.runtime !== dao.contract ||
          a.manifest.chain_id !== dao.chainId,
      )
    )
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archiveHistoryPage: async (input: z.infer<typeof ArchiveRoutes.historyPage.input>) => {
    const result = await request(
      ArchiveRoutes.historyPage.path,
      ArchiveRoutes.historyPage.response,
      ArchiveRoutes.historyPage.input.parse(input),
      60000,
    );
    if (
      daoPaymentKey(result.dao) !== daoPaymentKey(input.dao) ||
      result.manifestCommitment !== input.manifestCommitment
    )
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archiveRecover: async (input: z.infer<typeof ArchiveRoutes.recover.input>) => {
    const result = await request(
      ArchiveRoutes.recover.path,
      ArchiveRoutes.recover.response,
      ArchiveRoutes.recover.input.parse(input),
      60000,
    );
    if (
      daoPaymentKey(result.manifest.dao) !== daoPaymentKey(input.dao) ||
      result.manifestFile.commitment !== input.manifestCommitment
    )
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  archivePrune: async (dao: DaoRef, id: string, expectedManifestCommitment: string) => {
    const input = ArchiveRoutes.prune.input.parse({ expectedManifestCommitment }),
      result = await request(
        ArchiveRoutes.prune.path.replace(':id', z.uuid().parse(id)),
        ArchiveRoutes.prune.response,
        input,
        120000,
      );
    if (
      result.id !== id ||
      daoPaymentKey(result.dao) !== daoPaymentKey(dao) ||
      result.manifest?.commitment !== expectedManifestCommitment
    )
      throw new ApiFailure('DAO_REFERENCE');
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
  storageCuration: async (dao: DaoRef) => {
    const result = await request(
      ApiRoutes.curation.path + '?dao=' + encodeURIComponent(JSON.stringify(dao)),
      ApiRoutes.curation.response,
    );
    if (daoPaymentKey(result.dao) !== daoPaymentKey(dao)) throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
  storageRetain: async (input: z.infer<typeof ApiRoutes.retain.input>) => {
    const result = await request(
      ApiRoutes.retain.path,
      ApiRoutes.retain.response,
      ApiRoutes.retain.input.parse(input),
    );
    if (daoPaymentKey(result.dao) !== daoPaymentKey(input.dao))
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
  uploadBranding: async (value: BrandingUpload) => {
    const input = BrandingUploadSchema.parse(value);
    assertOperatorDao(input.dao);
    const result = await request(
      ApiRoutes.brandingUpload.path,
      ApiRoutes.brandingUpload.response,
      input,
      60000,
    );
    if (
      daoPaymentKey(result.dao) !== daoPaymentKey(input.dao) ||
      result.requestId !== input.requestId ||
      result.slot !== input.slot ||
      result.image.bytes !== input.bytes ||
      result.image.commitment !== input.commitment ||
      result.image.mediaType !== input.mediaType
    )
      throw new ApiFailure('UPLOAD_RECEIPT');
    return result;
  },
  recoverStorage: async (value: z.input<typeof ApiRoutes.storageRecover.input>) => {
    const input = ApiRoutes.storageRecover.input.parse(value);
    assertOperatorDao(input.dao);
    const result = await request(
      ApiRoutes.storageRecover.path,
      ApiRoutes.storageRecover.response,
      input,
      60000,
    );
    if (daoPaymentKey(result.dao) !== daoPaymentKey(input.dao) || result.kind !== input.kind)
      throw new ApiFailure('DAO_REFERENCE');
    return result;
  },
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
  exitPreflight: () =>
    request(AccountExitRoutes.exitPreflight.path, AccountExitRoutes.exitPreflight.response),
  beginExit: (intent: ExitIntent, statusCapability: string) =>
    request(AccountExitRoutes.exitBegin.path, AccountExitRoutes.exitBegin.response, {
      intent,
      statusCapability,
    }),
  exitStatus: (capability: string) =>
    request(
      AccountExitRoutes.exitStatus.path,
      AccountExitRoutes.exitStatus.response,
      { capability },
      60000,
    ),
  exitStep: (id: string, stepId: string, signed: z.infer<typeof SignedExitInstructionSchema>) =>
    request(
      ExitNativeStepRoute.path.replace(':id', id).replace(':stepId', stepId),
      ExitNativeStepRoute.response,
      { signed },
      60000,
    ),
  prepareExitSettlement: (signed: z.infer<typeof SignedExitInstructionSchema>) =>
    request(
      ExitSettlementRoutes.settlementPrepare.path,
      ExitSettlementRoutes.settlementPrepare.response,
      signed,
    ),
  exitSettlementReceipt: (packet: ExitSubmission) =>
    request(
      ExitSettlementRoutes.settlementReceipt.path,
      ExitSettlementRoutes.settlementReceipt.response,
      packet,
      60000,
    ),
  submitExitSettlement: (packet: ExitSubmission) =>
    request(
      ExitSettlementRoutes.settlementSubmit.path,
      ExitSettlementRoutes.settlementSubmit.response,
      packet,
      60000,
    ),
  daoHandover: (id: string) =>
    request(
      AccountExitRoutes.daoHandover.path.replace(':id', IdSchema.parse(id)),
      AccountExitRoutes.daoHandover.response,
    ),
  dao: (id: string) =>
    request(ApiRoutes.dao.path.replace(':id', IdSchema.parse(id)), ApiRoutes.dao.response),
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
  challenge: (input: z.infer<typeof ApiRoutes.challenge.input>) =>
    request(
      ApiRoutes.challenge.path,
      ApiRoutes.challenge.response,
      ApiRoutes.challenge.input.parse(input),
    ),
  login: async (
    challengeId: string,
    signature: string,
    encryptionKey: z.infer<typeof ApiRoutes.login.input>['encryptionKey'],
    check?: (account: Account) => void,
  ) => {
    const result = await request(ApiRoutes.login.path, ApiRoutes.login.response, {
      challengeId,
      signature,
      encryptionKey,
    });
    check?.(result.account);
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
  shareProfileKeys: (input: z.infer<typeof ApiRoutes.profileKeysShare.input>) => {
    const body = ApiRoutes.profileKeysShare.input.parse(input);
    assertOperatorDao({
      chainId: body.context.chainId,
      contract: body.context.runtime,
      daoId: body.context.daoId,
      interfaceVersion: 1,
    });
    return request(ApiRoutes.profileKeysShare.path, ApiRoutes.profileKeysShare.response, body);
  },
  removeProfileKeys: (input: z.infer<typeof ApiRoutes.profileKeysRemove.input>) => {
    const body = ApiRoutes.profileKeysRemove.input.parse(input);
    assertOperatorDao({
      chainId: body.context.chainId,
      contract: body.context.runtime,
      daoId: body.context.daoId,
      interfaceVersion: 1,
    });
    return request(ApiRoutes.profileKeysRemove.path, ApiRoutes.profileKeysRemove.response, body);
  },
  profileKeys: async (input: ProfileContext) => {
    const context = ProfileContextSchema.parse(input);
    assertOperatorDao({
      chainId: context.chainId,
      contract: context.runtime,
      daoId: context.daoId,
      interfaceVersion: 1,
    });
    const grant = await request(
      `/v1/profiles/${context.daoId}/${context.memberId}/keys/${context.profileRevision}`,
      ApiRoutes.profileKeysGet.response,
    );
    if (profileCipherDomain(context) !== profileCipherDomain(grant.context))
      throw new Error('PROFILE_KEY_CONTEXT');
    return grant;
  },
  profileRecipients: (daoId: string, after?: string) => {
    const query = ApiRoutes.profileRecipients.query.parse({ ...(after ? { after } : {}) });
    return request(
      `/v1/profiles/${IdSchema.parse(daoId)}/recipients${query.after ? '?after=' + query.after : ''}`,
      ApiRoutes.profileRecipients.response,
    );
  },
  people: (value: z.infer<typeof PeopleRoutes.list.query> = {}) => {
    const query = PeopleRoutes.list.query.parse(value);
    const params = new URLSearchParams();
    if (query.after !== undefined) params.set('after', query.after);
    if (query.daoId !== undefined) params.set('daoId', query.daoId);
    if (query.memberId !== undefined) params.set('memberId', query.memberId);
    return request(PeopleRoutes.list.path + '?' + params, PeopleRoutes.list.response);
  },
  publicMembers: (value: z.infer<typeof PeopleRoutes.members.query> = {}) => {
    const operator = currentOperator();
    const query = PeopleRoutes.members.query.parse(
      operator
        ? {
            ...value,
            onlyDao: operator.reference.daoId,
            daoId: value.daoId ?? operator.reference.daoId,
          }
        : value,
    );
    const params = new URLSearchParams();
    if (query.after !== undefined) params.set('after', query.after);
    if (query.daoId !== undefined) params.set('daoId', query.daoId);
    if (query.memberId !== undefined) params.set('memberId', query.memberId);
    if (query.onlyDao !== undefined) params.set('onlyDao', query.onlyDao);
    return request(PeopleRoutes.members.path + '?' + params, PeopleRoutes.members.response);
  },
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
  reconnectNativeAccount: (id: string, proof: NativeProof) =>
    request(
      ApiRoutes.accountReconnectNative.path,
      ApiRoutes.accountReconnectNative.response,
      ApiRoutes.accountReconnectNative.input.parse({ id, proof }),
    ),
  nativeChallenge: (purpose: 'login' | 'pair' | 'signup', account: string) =>
    request(
      '/v1/account/native/challenge',
      NativeChallengeSchema,
      NativeIntentSchema.parse({ purpose, account, permission: 'active' }),
    ),
  nativeFinish: (purpose: 'login' | 'pair' | 'signup', id: string, proof: NativeProof) =>
    purpose !== 'pair'
      ? request(
          purpose === 'signup' ? '/v1/sign-up/native' : '/v1/sign-in/native',
          SessionSchema,
          NativeFinishSchema.parse({ id, proof }),
        )
      : request(
          '/v1/account/native/link',
          NativeIdentitySchema,
          NativeFinishSchema.parse({ id, proof }),
        ),
  unlinkNative: (chainId: string) => request('/v1/account/native/unlink', z.null(), { chainId }),
  telosBallots: (cursor?: string, kind?: TelosBallotKind) =>
    request(
      TelosGovernanceRoutes.ballots.path +
        '?' +
        new URLSearchParams({
          ...(cursor ? { cursor } : {}),
          ...(kind ? { kind } : {}),
        }).toString(),
      TelosGovernanceRoutes.ballots.response,
    ),
  telosProducers: (cursor?: string) =>
    request(
      TelosGovernanceRoutes.producers.path +
        (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      TelosGovernanceRoutes.producers.response,
    ),
  telosBallot: (ballot: string) =>
    request(
      '/v1/telos/ballots/' + encodeURIComponent(ballot),
      TelosGovernanceRoutes.ballot.response,
    ),
  telosPrepare: (input: TelosVoteInput) =>
    request(
      TelosGovernanceRoutes.prepare.path,
      TelosGovernanceRoutes.prepare.response,
      TelosVoteInputSchema.parse(input),
    ),
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
  names: (input: NamesInventoryQuery = {}) => {
    const query = NamesInventoryQuerySchema.parse(input),
      params = new URLSearchParams();
    if (query.listingsCursor !== undefined) params.set('listingsCursor', query.listingsCursor);
    if (query.suffixesCursor !== undefined) params.set('suffixesCursor', query.suffixesCursor);
    return request('/v1/names' + (params.size ? '?' + params.toString() : ''), NamesServiceSchema);
  },
  nameQuote: (accountName: string) =>
    request(`/v1/names/quote?name=${encodeURIComponent(accountName)}`, NameQuoteSchema),
  nameCheckout: (input: { accountName: string; ownerKey: string; activeKey: string }) =>
    request('/v1/names/checkout', ServiceCheckoutSchema, input),
  docsAgent: () => request('/v1/docs/agent', DocsAgentStatusSchema),
  askDocs: (question: string) => request('/v1/docs/ask', DocsAnswerSchema, { question }, 20000),
  logout: async () => {
    await request(ApiRoutes.logout.path, ApiRoutes.logout.response, {});
    sessionStorage.removeItem(csrfStorageKey());
    recoveryGrant = undefined;
  },
};
export function friendlyError(error: unknown): string {
  const handoverErrors: Record<string, string> = {
    EXIT_SETTLEMENT_CONTEXT:
      'This settlement belongs to another exit report. Open its original report before retrying the signed transaction.',
    EXIT_MEMBERSHIP_CHANGED:
      'DAO membership, rights or duties changed. Refresh the review and confirm again.',
    EXIT_DAO_REVIEW_REQUIRED:
      'Refresh the DAO directory and review this administrator responsibility before deleting your hosted account.',
    EXIT_SOLE_MEMBER_REQUIRED:
      'Closure must be explicitly chosen by the only active member. Refresh this DAO before continuing.',
    EXIT_SIGNER_REQUIRED:
      'Use this native member’s original saved kit or linked wallet. The read-only report cannot sign a departure or settlement.',
    PRIVATE_HANDOVER_REQUIRED:
      'Prepare another active administrator’s private grants, then verify their decryption and recovery on another device before this handover.',
    PRIVATE_ACCESS_CONTEXT:
      'Private keys or policy changed. Load the current records and verify them again.',
    PRIVATE_ACCESS_INCOMPLETE:
      'Load and verify the complete permitted private history before handing over.',
  };
  const handoverCode =
    error instanceof ApiFailure ? error.code : error instanceof Error ? error.message : '';
  const handoverMessage = handoverErrors[handoverCode];
  if (handoverMessage) return handoverMessage;
  const telosMessages: Record<string, string> = {
    TELOS_UNAVAILABLE: 'Telos ballot records are temporarily unavailable. Try again later.',
    TELOS_CHAIN_MISMATCH:
      'The connection returned a different chain. Ask the operator to verify its Telos network.',
    TELOS_CURSOR_INVALID: 'The ballot page changed. Refresh records and try again.',
    TELOS_BALLOT_UNKNOWN: 'This ballot is unavailable or belongs to another treasury.',
    TELOS_BALLOT_UNSUPPORTED:
      'This ballot uses voting rules that this app does not support. Open the Telos voting app to review it.',
    TELOS_BALLOT_CLOSED: 'This ballot is outside its voting period. Refresh its records.',
    TELOS_OPTIONS_INVALID: 'Review the allowed selections for this ballot.',
    TELOS_ALREADY_VOTED: 'This ballot already records your vote and does not allow revoting.',
    TELOS_NO_WEIGHT:
      'The Telos voter record has no voting weight for this ballot. Review or refresh your stake in the Telos voting app.',
    TELOS_VOTE_UNAVAILABLE:
      'Voting is unavailable on this connection. Ask the operator to verify its contract version.',
    TELOS_BALLOT_CHANGED:
      'The ballot or your voting power changed during approval. Refresh and review your vote again.',
    TELOS_PREPARATION_EXPIRED: 'The vote preparation expired. Refresh and review your vote again.',
  };
  const code =
    error instanceof ApiFailure ? error.code : error instanceof Error ? error.message : undefined;
  if (code && telosMessages[code]) return telosMessages[code];
  const appMessages: Record<string, string> = {
    PROFILE_KEYS_UNAVAILABLE:
      'The profile key service is unavailable. Retry after the operator configures the matching service.',
    PROFILE_KEY_UNAVAILABLE:
      'This profile key envelope is missing. Your recovery kit cannot reconstruct a removed profile key.',
    PROFILE_AUDIENCE:
      'This profile is not shared with your current account. Joining the DAO alone does not grant access.',
    PROFILE_CONTEXT:
      'This profile belongs to another deployment or membership. Refresh the selected community.',
    PROFILE_KEY_CONTEXT:
      'This envelope does not match the profile or your account. Refresh; do not reuse it.',
    PROFILE_KEY_CHANGED:
      'A registered recipient key changed. Refresh the audience before publishing.',
    PROFILE_DELETION_UNAVAILABLE:
      'Profile key removal is unavailable. The current profile has not been removed; retry.',
    PROFILE_ENCRYPTION_REQUIRED:
      'This deployment requires encrypted profiles. Update the profile editor before publishing.',
    MINI_APP_RELEASE_UNAVAILABLE:
      'This deployment has no verified mini app starter. Ask its operator to install the matching release.',
    MINI_APP_RELEASE_VERSION:
      'The starter differs from this deployment. Ask its operator for the matching release.',
    APP_BINDING:
      'This configuration belongs to a different app or DAO. Choose your community and refresh it.',
    APP_CALLBACK: 'Use the exact HTTPS callback registered by your community administrator.',
    APP_REQUEST_EXPIRED: 'This consent request expired. Return to the app and sign in again.',
    APP_REVISED:
      'Your administrator changed the app registration. Return to the app and sign in again.',
    APP_DISABLED: 'Your community has suspended this app. Contact its administrator.',
    APP_UNKNOWN: 'No registered app was found. Refresh or ask your administrator to register it.',
    APP_GRANT_REQUIRED:
      'The recording grant could not be verified. Refresh your membership and approve it again.',
    ADMIN_REQUIRED: 'Ask an active community administrator to register or configure this app.',
    MEMBERSHIP_REQUIRED: 'Sign in as an active member of this community before continuing.',
  };
  if (code && appMessages[code]) return appMessages[code];
  if (error instanceof ApiFailure) {
    const messages: Record<string, string> = {
      MODULE_BILLING_UNCONFIGURED: 'Module access payments are not configured on this service.',
      MODULE_PRICING_UNAVAILABLE:
        'Current module prices could not be verified. Refresh to try again.',
      MODULE_APPROVAL_CHANGED:
        'Module pricing or eligibility changed. Refresh access before approving a payment.',
      MODULE_ORDER_CONFLICT:
        'This payment does not match the selected DAO and approved module price.',
      MODULE_ORDER_PENDING:
        'This module already has an unfinished payment. Continue that checkout or contact support.',
      MODULE_RENEWAL_EARLY:
        'Module access can be renewed during the final seven days of the paid month.',
      MODULE_ACCESS_FREE: 'This DAO has free module access. No payment is needed.',
      MODULE_CHECKOUT_REVIEW:
        'An earlier checkout needs payment review. Contact support before starting another payment.',
      MODULE_NOT_INSTALLED: 'Enable this module in DAO settings before buying access.',
      RECOVERY_UNAVAILABLE:
        'Fast sign-in backups are not available on this service yet. You can still use another unlocked device or your encrypted kit.',
      RECOVERY_METHOD_UNAVAILABLE:
        'Full access through this method is not available yet. Choose another method or use an unlocked device.',
      RECOVERY_ASSISTED_UNAVAILABLE:
        'Daclify-assisted recovery is unavailable. Use another full-access method, an unlocked device or your encrypted kit.',
      RECOVERY_BACKUP_UNAVAILABLE:
        'Your encrypted backup could not be verified or retrieved. Your existing keys are unchanged. Try again or use another recovery method.',
      RECOVERY_CUSTODY_UNAVAILABLE:
        'The recovery key service is unavailable. Try again or use another recovery method.',
      RECOVERY_GRANT_INVALID:
        'This recovery request has expired or was already used. Sign in again through a full-access method.',
      RECOVERY_HANDOFF_INVALID: 'The recovery setup request is no longer valid. Start setup again.',
      RECOVERY_FALLBACK_REQUIRED:
        'Keep another full-access method enabled, or confirm that you have saved your encrypted kit and its unlocking secret.',
      RECOVERY_DEVICE_INVALID:
        'This device request has expired, was cancelled or was already used. Create a new request.',
      RECOVERY_DEVICE_MISMATCH:
        'The device verification details changed. Cancel the request and start again.',
      ...ContractFailureMessages,
      NATIVE_EXECUTIVE_BINDING_REQUIRED:
        'Replace or remove your DAO wallet binding first. The final paired executive must replace the wallet atomically.',
      NETWORK_MISMATCH:
        'The connected service is using a different network from this app. Ask the operator to correct the API configuration.',
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
        'Your original account was found. Restore that account to continue with these keys.',
      VAULT_ALREADY_CONFIGURED:
        'This account already has Daclify keys. Unlock its original vault instead.',
      ACCOUNT_RECONNECT_IDENTITY:
        'This kit does not match a registered account. Use the original recovery kit for the account you want to restore.',
      ACCOUNT_RECONNECT_CONFLICT:
        'These accounts have conflicting sign-in methods, memberships or saved requests, or would exceed the passkey limit. Their access was kept intact. You can restore the original account without reconnecting sign-ins.',
      ACCOUNT_RECONNECT_CHANGED:
        'Account access changed while you were restoring it. Refresh and try again.',

      PRIVATE_ACCESS_CONTEXT:
        'Private keys or policy changed. Load the current records and verify them again.',
      PRIVATE_ACCESS_INCOMPLETE:
        'The private history is incomplete. Finish loading and verify the full permitted history.',
      PRIVATE_HANDOVER_REQUIRED:
        'Prepare another active administrator’s private grants, then verify their decryption and recovery on another device before this handover.',
      PRIVATE_ACCESS_UNAVAILABLE:
        'Private-access records could not be refreshed. Refresh the DAO before continuing.',
      ACTION_REFRESH_REQUIRED:
        'The action was submitted. Refresh the DAO to check its result before retrying.',
      VAULT_PROOF_INVALID:
        'The key setup proof expired or was rejected. Unlock your vault and try again.',
      AUTH_INVALID: 'The login proof expired or was already used. Try again.',
      KEY_CHANGE_REQUIRED:
        'This account uses a different encryption key. Use its original recovery kit.',
      CSRF_REQUIRED: 'Refresh your session by signing in again.',
      CHAIN_ACTION_REJECTED:
        'The contract rejected the action. Refresh the DAO and check your permissions.',
      CHAIN_UNAVAILABLE: 'The blockchain node is unavailable. Try again later.',
      STORAGE_CURATION_CHANGED:
        'Another administrator updated the file selection. Refresh and review it.',
      STORAGE_KEEP_CAPACITY:
        'These whole files exceed the free storage allowance. Select fewer files.',
      STORAGE_KEEP_UNKNOWN: 'A selected storage object is no longer available. Refresh the list.',
      STORAGE_REMOVAL_REVIEW:
        'Storage cleanup is paused for operator review; its recovery staging is retained.',
      CONTENT_HOSTING_ENDED:
        'Hosting for this file has ended. Restore a separately saved copy or re-pin it.',
      CONTENT_GATEWAY_ALLOWANCE_REQUIRED:
        'The operator has not configured an active gateway allowance. Your files remain pinned; contact the operator or use your saved export.',
      CONTENT_GATEWAY_ALLOWANCE_EXPIRED:
        'The gateway allowance is outside its funded period. Ask the operator to renew it. Your files remain pinned.',
      CONTENT_GATEWAY_ALLOWANCE_EXHAUSTED:
        'The operator’s shared gateway allowance is exhausted. Your files remain pinned; contact the operator or use your saved export.',
      ARCHIVE_PRUNING_DISABLED:
        'The operator has not enabled qualified source pruning. Your records remain on chain.',
      ARCHIVE_APPROVAL_REQUIRED:
        'An exact active administrator approval is required before pruning.',
      ARCHIVE_PROGRESS_CHANGED: 'Another batch advanced this archive. Refresh its status.',
      ARCHIVE_HISTORY_UNAVAILABLE: 'On-chain archive discovery is unavailable on this deployment.',
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
      RAM_MIGRATION_ACTIVE:
        'The operator is completing the RAM migration. Totals will be available after all contracts are verified.',
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
      NATIVE_CONTEXT_REVIEW_REQUIRED:
        'Restore the code-only execution context and complete core action links before handover.',
      NATIVE_POLICY_MIGRATION_REQUIRED:
        'This runtime needs a reviewed ownership-policy upgrade before native ownership transactions can be prepared.',
      NATIVE_OWNERSHIP_RUNTIME_REQUIRED:
        'The deployed runtime does not match the reviewed ownership release. Upgrade and verify its code and ABI first.',
      NATIVE_HANDOVER_CHANGED:
        'Ownership policy or executive state changed. Refresh and prepare a new handover proposal.',
      NATIVE_AUTHORITY_REVIEW_REQUIRED:
        'Current authorities or links need operator review before handover.',
      PERMISSION_LINKS_UNAVAILABLE:
        'The RPC did not provide complete permission links. Use a compatible RPC before preparing ownership changes.',
      PERMISSION_ANY_LINK_REVIEW_REQUIRED:
        'Unrestricted action links need operator review before ownership changes.',
      CUSTODY_POLICY: 'This DAO requires user-controlled keys.',
      RESULT_LIMIT:
        'This deployment exceeds the current read limit. Configure an indexed read service.',
      STORAGE_UNCONFIGURED: 'Hosted storage is not configured on this service.',
      PENDING_REQUEST_STORAGE:
        'This browser could not save the upload for safe retry. Free tab storage or choose a smaller image before uploading.',
      STORAGE_RECOVERY_UNSUPPORTED:
        'This provider cannot verify hosted ownership for recovery. Ask the operator to restore its database or provider configuration.',
      STORAGE_RECOVERY_COVERAGE:
        'The surviving reference page could not be verified completely. Retry or ask the operator to investigate.',
      STRIPE_NOT_CONFIGURED: 'Card payments are not configured on this service.',
      NAMES_UNCONFIGURED: 'The Telos nameservice is not on this chain yet.',
      CARD_UNAVAILABLE: 'This name has no card price on chain.',
      NAME_TAKEN: 'That Telos account already exists.',
      NAME_SOLD: 'That name has already been sold.',
      NAME_PRICE: 'The card amount does not match the on-chain price.',
      TIER_UNSET: 'That name tier is not set on chain.',
      FEE_UNSET: 'Nameservice fees are not set on this chain yet.',
      FEE_RULE: 'Accept the displayed fee policy before publishing a name listing.',
      NATIVE_SUFFIX_REQUIRED:
        'Use the final native suffix owned by this seller. Dotted suffix sellers are not supported.',
      NAME_CARD_SELLER_UNSUPPORTED:
        'Third-party names use TLOS until card seller routing is available.',
      NAME_CARD_PREMIUM_UNSUPPORTED:
        'Premium names require native TLOS checkout and applicable namespace or auction authority.',
      PRICE_CHANGED: 'The name price or terms changed. Check the name again before paying.',
      SELLER: 'Only the native seller authority can change this listing.',
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
      SIGNUP_ATTEMPT_INVALID:
        'Account setup expired or belongs to another browser. Start over and verify your email or Telegram again.',
      SIGNUP_INCOMPLETE:
        'This account’s encrypted setup is still pending. Return to its setup tab and retry.',
      SIGNUP_ALREADY_COMPLETE:
        'Account setup is already complete. Sign in with your paired method.',
      SIGNUP_IDENTITY_CHANGED:
        'The keys for this setup changed. Start over and verify your email or Telegram again.',
      RECOVERY_AUTHORITY_CHANGED:
        'Assisted recovery changed after this request started. Refresh and review consent again.',
      EMAIL_UNAVAILABLE: 'Email delivery is not configured on this server.',
      EMAIL_DELIVERY_FAILED: 'The email could not be sent. Try again or use another paired method.',
      EMAIL_INVALID: 'That email code is not valid anymore.',
      CREDENTIAL_LINKED:
        'That sign-in method belongs to another account. If you just restored your kit, use Reconnect existing sign-ins under Telos Zero to bring back your previous methods.',
      NATIVE_LINKED:
        'That Telos Zero wallet belongs to another account. If you just restored your kit, use Reconnect existing sign-ins below to bring back your previous methods.',
      ACCOUNT_RECONNECT_REGISTERED:
        'That wallet belongs to an account with its own keys. Sign in to that account with its original kit; accounts with different keys cannot be combined here.',
      ACCOUNT_RECONNECT_NOT_NEEDED:
        'This wallet is already paired with this account. Its sign-ins are already available here.',
      CREDENTIAL_UNKNOWN: 'That sign-in method is not paired with this account.',
      PASSKEY_INVALID: 'The passkey could not be verified. Try again.',
      PASSKEY_LINKED: 'That passkey is already paired with an account.',
      PASSKEY_LIMIT: 'This account already has the maximum number of passkeys.',
      RATE_LIMIT: 'Too many requests. Wait a moment and try again.',
      DOCS_AGENT_UNAVAILABLE: 'Daxi is not configured on this server.',
      DOCS_AGENT_FAILED: 'Daxi could not answer. Try again.',
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
      NATIVE_CONTEXT_REVIEW_REQUIRED:
        'Restore the code-only execution context and complete core action links before handover.',
      NATIVE_POLICY_MIGRATION_REQUIRED:
        'This runtime needs a reviewed ownership-policy upgrade before native ownership transactions can be prepared.',
      NATIVE_OWNERSHIP_RUNTIME_REQUIRED:
        'The deployed runtime does not match the reviewed ownership release. Upgrade and verify its code and ABI first.',
      NATIVE_HANDOVER_CHANGED:
        'Ownership policy or executive state changed. Refresh and prepare a new handover proposal.',
      NATIVE_AUTHORITY_REVIEW_REQUIRED:
        'Current authorities or links need operator review before handover.',
      PERMISSION_LINKS_UNAVAILABLE:
        'The RPC did not provide complete permission links. Use a compatible RPC before preparing ownership changes.',
      PERMISSION_ANY_LINK_REVIEW_REQUIRED:
        'Unrestricted action links need operator review before ownership changes.',
      CUSTODY_POLICY: 'This DAO requires user-controlled keys.',
      PASSKEY_PRF_UNAVAILABLE:
        'This passkey or browser cannot unlock the encrypted vault. Use another full-access method, an unlocked device or your encrypted kit.',
      PASSKEY_PRF_INVALID:
        'The passkey did not return a valid private unlock result. Try another full-access method.',
      RECOVERY_WALLET_UNSUPPORTED:
        'This wallet did not reproduce the same private unlock signature. Full access was not enabled. Choose another protection option.',
      RECOVERY_KEY_MISMATCH:
        'The recovered keys do not match this account. Your existing vault is unchanged.',
      RECOVERY_DEVICE_MISMATCH:
        'The device verification details changed. Cancel this request and start again.',
      RECOVERY_DEVICE_EXPIRED: 'The device approval request expired. Create a new request.',
      RECOVERY_CONSENT_REQUIRED:
        'Review and allow Daclify’s spare-key access before enabling assisted recovery.',
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
      DOCUMENT_CONTENT_UNAVAILABLE:
        'This version could not be opened. Unlock your account and check permitted document access before accepting.',
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
