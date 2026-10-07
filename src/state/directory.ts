import { DaoPurposeSchema, type DaoSummary, type UserMembership } from '@daclify/core-protocol';
export function directoryQuery(query: Record<string, unknown>) {
  const purpose = DaoPurposeSchema.safeParse(query.purpose);
  return {
    q: typeof query.q === 'string' ? query.q.slice(0, 200) : '',
    purpose: purpose.success ? purpose.data : '',
    mine: query.mine === '1',
    sort: query.sort === 'members' ? 'members' : 'name',
  };
}
export function directoryMember(dao: DaoSummary, members: UserMembership[]) {
  return members.find(
    (m) =>
      m.active &&
      m.dao.chainId === dao.reference.chainId &&
      m.dao.contract === dao.reference.contract &&
      m.dao.daoId === dao.reference.daoId &&
      m.dao.interfaceVersion === dao.reference.interfaceVersion,
  );
}
export function filterDirectory(
  daos: DaoSummary[],
  members: UserMembership[],
  query: ReturnType<typeof directoryQuery>,
) {
  const text = query.q.trim().toLocaleLowerCase();
  return daos
    .filter(
      (dao) =>
        (!query.mine || !!directoryMember(dao, members)) &&
        (!query.purpose || (dao.purpose ?? 'custom') === query.purpose) &&
        (!text ||
          `${dao.title} ${dao.branding?.summary ?? ''} ${dao.description}`
            .toLocaleLowerCase()
            .includes(text)),
    )
    .sort(
      (a, b) =>
        (query.sort === 'members' ? b.members - a.members : 0) ||
        a.title.localeCompare(b.title) ||
        JSON.stringify(a.reference).localeCompare(JSON.stringify(b.reference)),
    );
}
