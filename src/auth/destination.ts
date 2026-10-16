export function accountDestination(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return;
  const url = new URL(value, 'https://daclify.invalid');
  if (url.origin !== 'https://daclify.invalid' || url.pathname === '/account') return;
  return url.pathname + url.search + url.hash;
}
export function approvalSetupLocation(returnTo: string, daoId?: string) {
  return {
    path: '/account',
    query: {
      setup: 'approvals',
      returnTo: accountDestination(returnTo) ?? '/hub',
      ...(daoId ? { dao: daoId } : {}),
    },
  };
}
export function createdDaoLocation(daoId: string) {
  return '/dao/' + daoId;
}
