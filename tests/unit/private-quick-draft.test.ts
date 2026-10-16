import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AccountSchema, DaoRefSchema } from '@daclify/core-protocol';
import { useWorkspace } from '../../src/state/workspace';
import {
  loadPrivateQuickDraft,
  savePrivateQuickDraft,
  clearPrivateQuickDraft,
} from '../../src/content/private-quick-draft';
const dao = DaoRefSchema.parse({
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '7',
  interfaceVersion: 1,
});
const fields = { runtime: dao.contract, dao_id: dao.daoId, member_id: '1', ballot_id: '9' };
const settings = {
  protocol: 2,
  all_accounts: false,
  audience: ['7'],
  closes: 0,
  readers: [{ member_id: '1', encryption_key: 'public-reader-key' }],
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
it('retains only scoped technical preparation and an exact signed-opening candidate', () => {
  const draft = { stage: 'content', fields, settings };
  savePrivateQuickDraft(dao, 'quickvote', '1', draft);
  expect(loadPrivateQuickDraft(dao, 'quickvote', '1')).toEqual(draft);
  expect(loadPrivateQuickDraft({ ...dao, daoId: '8' }, 'quickvote', '1')).toBeUndefined();
  expect(loadPrivateQuickDraft(dao, 'foreign', '1')).toBeUndefined();
  const question = JSON.stringify({
    documentId: '9',
    version: 1,
    commitment: 'ab'.repeat(32),
    keyEpoch: '1',
  });
  const opening = {
    stage: 'opening',
    fields: {
      ...fields,
      definition: { ...settings, question, explanation: '' },
      key: 'ab'.repeat(96),
      possession: 'cd'.repeat(64),
      grants: ['ef'.repeat(48)],
    },
  };
  expect(() =>
    savePrivateQuickDraft(dao, 'quickvote', '1', { ...opening, contentVersion: 2 }),
  ).toThrow('QUICK_QUESTION_PARENT');
  savePrivateQuickDraft(dao, 'quickvote', '1', opening);
  expect(loadPrivateQuickDraft(dao, 'quickvote', '1')).toEqual(opening);
  clearPrivateQuickDraft(dao, 'quickvote', '1');
  expect(loadPrivateQuickDraft(dao, 'quickvote', '1')).toBeUndefined();
});
it('rejects plaintext, vote secrets, foreign audiences, copied parents and changed actors', () => {
  for (const draft of [
    { stage: 'content', fields, settings: { ...settings, question: 'Secret question canary' } },
    { stage: 'content', fields, settings, secret: 'must never be stored' },
    { stage: 'content', fields, settings: { ...settings, audience: ['8'] } },
    { stage: 'content', fields: { ...fields, member_id: '2' }, settings },
    {
      stage: 'opening',
      fields: {
        ...fields,
        definition: { ...settings, question: 'Secret question canary', explanation: '' },
        key: 'ab',
        possession: 'cd',
        grants: [],
      },
    },
  ])
    expect(() => savePrivateQuickDraft(dao, 'quickvote', '1', draft)).toThrow();
  expect([...values.values()].join('')).not.toContain('Secret question canary');
});
