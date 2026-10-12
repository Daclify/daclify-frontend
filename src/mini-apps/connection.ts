import {
  daoPaymentKey,
  MiniAppConnectionSchema,
  type DaoSummary,
  type MiniAppConnection,
  type UserMembership,
  type ConnectedAppConfig,
} from '@daclify/core-protocol';

export function connectionMember(
  dao: DaoSummary,
  memberships: UserMembership[],
): UserMembership | undefined {
  return memberships.find(
    (member) => member.active && daoPaymentKey(member.dao) === daoPaymentKey(dao.reference),
  );
}

export function connectionJson(
  input: MiniAppConnection,
  dao: DaoSummary,
  appId: string,
  registered: { clientId: string; config: Pick<ConnectedAppConfig, 'redirectUris'> },
): string {
  const bundle = MiniAppConnectionSchema.parse(input),
    binding = bundle.binding;
  if (
    binding.chainId !== dao.reference.chainId ||
    binding.runtime !== dao.reference.contract ||
    binding.daoId !== dao.reference.daoId ||
    binding.appId !== appId ||
    binding.clientId !== registered.clientId
  )
    throw new Error('APP_BINDING');
  if (!registered.config.redirectUris.includes(bundle.callbackUrl)) throw new Error('APP_CALLBACK');
  return JSON.stringify(bundle, null, 2) + '\n';
}
