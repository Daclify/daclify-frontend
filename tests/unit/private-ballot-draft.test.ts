import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AccountSchema, DaoRefSchema } from '@daclify/core-protocol';
import { useWorkspace } from '../../src/state/workspace';
import {
  loadPrivateBallotDraft,
  savePrivateBallotDraft,
  clearPrivateBallotDraft,
} from '../../src/content/private-ballot-draft';
const dao = DaoRefSchema.parse({
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '1',
  interfaceVersion: 1,
});
const fields = {
  runtime: dao.contract,
  dao_id: dao.daoId,
  member_id: '1',
  ballot_id: '9',
  kind: 0,
  choices: 2,
  duration: 300,
  quorum: 5000,
  approval: 5001,
  metadata: '',
};
let values: Map<string, string>;
beforeEach(() => {
  setActivePinia(createPinia());
  values = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  useWorkspace().account = AccountSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    custody: 'user-controlled',
    signingKey: null,
    encryptionKey: null,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setActivePinia(undefined);
});
it('keeps only technical recovery state, scoped to the original account, deployment and member', () => {
  const draft = { stage: 'content', action: 'open', fields };
  savePrivateBallotDraft(dao, 'decide', '1', draft);
  expect(loadPrivateBallotDraft(dao, 'decide', '1')).toEqual(draft);
  expect(loadPrivateBallotDraft({ ...dao, daoId: '2' }, 'decide', '1')).toBeUndefined();
  expect(loadPrivateBallotDraft(dao, 'decide', '2')).toBeUndefined();
  const account = useWorkspace().account;
  if (!account) throw Error('fixture account');
  account.id = '22222222-2222-4222-8222-222222222222';
  expect(loadPrivateBallotDraft(dao, 'decide', '1')).toBeUndefined();
});
it('refuses plaintext, another actor and substituted private document parents at the storage boundary', () => {
  expect(() =>
    savePrivateBallotDraft(dao, 'decide', '1', {
      stage: 'content',
      action: 'open',
      fields: { ...fields, metadata: 'Private canary' },
    }),
  ).toThrow();
  expect(() =>
    savePrivateBallotDraft(dao, 'decide', '1', {
      stage: 'content',
      action: 'open',
      fields: { ...fields, member_id: '2' },
    }),
  ).toThrow('PRIVATE_BALLOT_CONTEXT');
  const metadata = {
    schemaVersion: 4,
    semantics: 'proposal',
    options: [0, 1],
    privateContent: { documentId: '9', version: 1, keyEpoch: '1', commitment: 'cd'.repeat(32) },
  };
  const draft = {
    stage: 'opening',
    action: 'open',
    fields: { ...fields, metadata: JSON.stringify(metadata) },
  };
  savePrivateBallotDraft(dao, 'decide', '1', draft);
  expect(loadPrivateBallotDraft(dao, 'decide', '1')).toEqual(draft);
  expect(JSON.stringify([...values.values()])).not.toContain('Private canary');
  expect(() =>
    savePrivateBallotDraft(dao, 'decide', '1', {
      ...draft,
      fields: { ...draft.fields, ballot_id: '10' },
    }),
  ).toThrow('PRIVATE_BALLOT_CONTEXT');
  clearPrivateBallotDraft(dao, 'decide', '1');
  expect(loadPrivateBallotDraft(dao, 'decide', '1')).toBeUndefined();
});
