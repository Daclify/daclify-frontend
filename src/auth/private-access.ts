import type { DaoContent, Privacy } from '@daclify/core-protocol';

export function planPrivateAccess(
  content: DaoContent,
  actor: string,
  history: 'full-history' | 'from-join',
  privacy: Privacy,
) {
  const grants: { recipient: DaoContent['members'][number]; epoch: string }[] = [];
  const pending: { recipient: string; epoch: string }[] = [];
  const held = new Set(content.keyGrants.map((g) => `${g.recipient}:${g.epoch}`));
  const epochs = content.epochs
    .map((e) => e.epoch)
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  for (const recipient of content.members) {
    if (!recipient.active || (privacy === 'encrypted-user-controlled' && recipient.custody === 1))
      continue;
    for (const epoch of epochs) {
      if (
        (history === 'from-join' && BigInt(epoch) < BigInt(recipient.join_epoch)) ||
        held.has(`${recipient.id}:${epoch}`)
      )
        continue;
      if (held.has(`${actor}:${epoch}`)) grants.push({ recipient, epoch });
      else pending.push({ recipient: recipient.id, epoch });
    }
  }
  return { grants, pending };
}

export function privateSuccessors(content: DaoContent, departing: string) {
  const grants = new Set(content.keyGrants.map((g) => `${g.recipient}:${g.epoch}`));
  return content.members.filter(
    (m) =>
      m.id !== departing &&
      m.active &&
      m.admin &&
      content.epochs.every((e) => grants.has(`${m.id}:${e.epoch}`)),
  );
}
