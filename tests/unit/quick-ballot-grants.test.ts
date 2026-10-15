import { expect, it } from 'vitest';
import { createBallotKey } from '@daclify/modules/quick-ballot-proof';
import { generateVaultSecrets } from '../../src/auth/vault';
import { createBallotGrant, openBallotGrant } from '../../src/quick-ballots/keys';

it('fits eight actual encrypted reader grants and binds each to its fixed ballot and recipient', async () => {
  const ballot = createBallotKey('11'.repeat(32));
  const base = {
    chainId: '22'.repeat(32),
    runtime: 'daclifycore1',
    source: 'quickvote',
    ballotId: '9',
    definitionHash: '33'.repeat(32),
  };
  const other = await generateVaultSecrets();
  for (let index = 1; index <= 8; index++) {
    const reader = await generateVaultSecrets(),
      key = reader.encryptionPrivateKey;
    const publicKey = JSON.stringify({ kty: key.kty, crv: key.crv, x: key.x, y: key.y });
    const context = { ...base, memberId: String(index) };
    expect(new TextEncoder().encode(publicKey).length).toBeLessThanOrEqual(256);
    const grant = await createBallotGrant(context, publicKey, ballot.secret);
    expect(grant.length / 2).toBeLessThanOrEqual(768);
    expect(await openBallotGrant(context, key, grant)).toBe(ballot.secret);
    await expect(openBallotGrant(context, other.encryptionPrivateKey, grant)).rejects.toThrow();
    await expect(
      openBallotGrant({ ...context, definitionHash: '44'.repeat(32) }, key, grant),
    ).rejects.toThrow();
    await expect(openBallotGrant({ ...context, memberId: '10' }, key, grant)).rejects.toThrow();
    expect(grant).not.toContain(ballot.secret);
  }
});
