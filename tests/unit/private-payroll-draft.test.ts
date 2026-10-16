import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AccountSchema, DaoRefSchema } from '@daclify/core-protocol';
import { useWorkspace } from '../../src/state/workspace';
import {
  loadPrivatePayrollDraft,
  savePrivatePayrollDraft,
  clearPrivatePayrollDraft,
} from '../../src/content/private-payroll-draft';
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
  schedule_id: '9',
  recipient: '2',
  quantity: '1.0000 TLOS',
  periods: 2,
  interval: 86400,
  starts: 1060,
  document_id: '42',
  document_version: 1,
  expected: 'aa'.repeat(32),
  successor_of: '0',
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
it('retains exact public financial fields and scopes recovery to the original account and deployment', () => {
  const draft = { stage: 'content', fields };
  savePrivatePayrollDraft(dao, 'payroll', '1', draft);
  expect(loadPrivatePayrollDraft(dao, 'payroll', '1')).toEqual(draft);
  expect(loadPrivatePayrollDraft({ ...dao, daoId: '2' }, 'payroll', '1')).toBeUndefined();
  expect(loadPrivatePayrollDraft(dao, 'otherpayroll', '1')).toBeUndefined();
  expect(loadPrivatePayrollDraft(dao, 'payroll', '2')).toBeUndefined();
  const account = useWorkspace().account;
  if (!account) throw Error('fixture account');
  account.id = '22222222-2222-4222-8222-222222222222';
  expect(loadPrivatePayrollDraft(dao, 'payroll', '1')).toBeUndefined();
  account.id = '11111111-1111-4111-8111-111111111111';
  clearPrivatePayrollDraft(dao, 'payroll', '1');
  expect(loadPrivatePayrollDraft(dao, 'payroll', '1')).toBeUndefined();
});
it('refuses plaintext, changed actors and a protected label belonging to another schedule', () => {
  expect(() =>
    savePrivatePayrollDraft(dao, 'payroll', '1', {
      stage: 'content',
      fields: { ...fields, label: 'secret payroll name canary' },
    }),
  ).toThrow();
  expect(() =>
    savePrivatePayrollDraft(dao, 'payroll', '1', {
      stage: 'content',
      fields: { ...fields, member_id: '2' },
    }),
  ).toThrow();
  const label = { document_id: '9', version: 1, commitment: 'ab'.repeat(32), key_epoch: '1' };
  savePrivatePayrollDraft(dao, 'payroll', '1', {
    stage: 'committing',
    fields: { ...fields, label },
  });
  expect(() =>
    savePrivatePayrollDraft(dao, 'payroll', '1', {
      stage: 'committing',
      fields: { ...fields, label: { ...label, document_id: '10' } },
    }),
  ).toThrow();
  expect([...values.values()].join('')).not.toContain('secret payroll name canary');
});
