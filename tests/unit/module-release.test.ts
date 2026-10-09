import { expect, it } from 'vitest';
import { Catalog, ModuleStateSchema } from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { verifiedModuleRelease } from '../../src/api/client';
it('accepts the unchanged contract release after an SDK update and rejects older unsupported binaries', () => {
  const manifest = Catalog.find((m) => m.id === 'decide');
  if (!manifest) throw new Error('FIXTURE_MANIFEST');
  const state = ModuleStateSchema.parse({
    dao: { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
    modules: [
      {
        deployment: {
          id: 'decide',
          account: 'decide',
          version: manifest.version,
          codeHash: ModuleCodeHashes.decide,
        },
        manifest,
        enabled: true,
        compatible: true,
        codeVerified: true,
        actions: ['open', 'vote'],
        grants: ['govlock'],
      },
    ],
    ballots: [],
    votes: [],
    projects: [],
    milestones: [],
    schedules: [],
    entries: [],
    controls: [],
  });
  expect(verifiedModuleRelease(state).modules[0]).toMatchObject({
    compatible: true,
    codeVerified: true,
  });
  const older = structuredClone(state);
  const deployment = older.modules[0]?.deployment;
  if (!deployment) throw new Error('FIXTURE_MODULE');
  deployment.version = '0.4.0-alpha.0';
  deployment.codeHash = '11'.repeat(32);
  expect(verifiedModuleRelease(older).modules[0]).toMatchObject({
    compatible: false,
    codeVerified: false,
  });
  expect(older.modules[0]?.compatible).toBe(true);
});
