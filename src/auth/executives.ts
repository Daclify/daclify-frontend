import type { GovernanceState } from '@daclify/core-protocol';
export function executiveStatus(
  state: GovernanceState | undefined,
  memberId: string | undefined,
  now: number,
) {
  const office = state?.executives.find((row) => row.member_id === memberId);
  const paired =
    state?.executives.filter((row) => {
      const person = state.executiveMembers.find((member) => member.id === row.member_id);
      return (
        person?.active &&
        Boolean(person.native_account) &&
        !state.actors.find((actor) => actor.id === row.member_id)?.revoked
      );
    }) ?? [];
  const timeout = state?.executivePolicy?.inactivity_seconds;
  const active = paired.filter(
    (row) =>
      timeout === 0 ||
      (timeout !== undefined && row.last_active <= now && now - row.last_active < timeout),
  );
  return {
    office,
    effectiveSigners: (active.length ? active : paired)
      .map(
        (row) => state?.executiveMembers.find((m) => m.id === row.member_id)?.native_account ?? '',
      )
      .sort(),
    pairedCount: paired.length,
    activeCount: active.length,
    lastPaired: Boolean(
      state?.nativeGovernance?.handed_over &&
      office &&
      paired.some((row) => row.member_id === memberId) &&
      paired.length === 1,
    ),
  };
}
