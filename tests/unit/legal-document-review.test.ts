import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AccountSchema, DaoContentSchema, DaoRefSchema, NetworkSchema, contentDomain, epochGrantDomain } from '@daclify/core-protocol';
import { api } from '../../src/api/client';
import { readDocumentForReview } from '../../src/content/document-review';
import { preparePublicFile, preparePrivateFile, type PreparedFile } from '../../src/content/files';
import { createVault, createEpochGrant, sha256Hex } from '../../src/auth/vault';
import { saveVault, unlockAndLogin, lockVault } from '../../src/auth/session';
import { useWorkspace } from '../../src/state/workspace';

const dao = DaoRefSchema.parse({ chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 });
const cid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const metadata = { version: 1 as const, filename: 'Member agreement.md', mediaType: 'text/markdown' };
function storage(): Storage {
  const map = new Map<string, string>();
  return { get length() { return map.size; }, key: (index) => [...map.keys()][index] ?? null, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); }, clear: () => map.clear() };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('window', { location: { origin: 'http://localhost:5178' } });
});
afterEach(() => { lockVault(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setActivePinia(undefined); });
function document(prepared: PreparedFile) {
  return { id: '1', document_id: '42', version: 1, author: '1', cid, metadata: prepared.metadata, bytes: prepared.bytes, commitment: prepared.commitment, envelope_version: prepared.envelopeVersion, key_epoch: prepared.envelopeVersion ? '1' : '0' };
}
const empty = () => DaoContentSchema.parse({ dao, documents: [], members: [], epochs: [], keyGrants: [] });

it('previews only verified bounded UTF-8 Markdown and leaves other downloads unchanged', async () => {
  const text = '# Reviewed agreement\n\n<script>untrusted</script>';
  const prepared = await preparePublicFile(new TextEncoder().encode(text), metadata);
  const bytes = vi.spyOn(api, 'documentBytes').mockResolvedValue({ content: prepared.content });
  expect((await readDocumentForReview(dao, undefined, document(prepared), empty())).markdown).toBe(text);
  await expect(readDocumentForReview(dao, undefined, { ...document(prepared), commitment: 'ff'.repeat(32) }, empty())).rejects.toThrow('DOCUMENT_INTEGRITY');
  const invalid = await preparePublicFile(new Uint8Array([0xc3, 0x28]), metadata);
  bytes.mockResolvedValue({ content: invalid.content });
  await expect(readDocumentForReview(dao, undefined, document(invalid), empty())).rejects.toThrow('DOCUMENT_TEXT_ENCODING');
  const large = await preparePublicFile(new Uint8Array(131073).fill(65), metadata);
  bytes.mockResolvedValue({ content: large.content });
  await expect(readDocumentForReview(dao, undefined, document(large), empty())).rejects.toThrow('DOCUMENT_TEXT_SIZE');
  expect((await readDocumentForReview(dao, undefined, document(large), empty(), { previewMarkdown: false })).file?.bytes.length).toBe(131073);
  const pdf = await preparePublicFile(new Uint8Array([1, 2, 3]), { ...metadata, filename: 'terms.pdf', mediaType: 'application/pdf' });
  bytes.mockResolvedValue({ content: pdf.content });
  const result = await readDocumentForReview(dao, undefined, document(pdf), empty());
  expect(result.markdown).toBeUndefined(); expect(result.file?.bytes).toEqual(new Uint8Array([1, 2, 3]));
});

async function recoveredFixture() {
  const password = 'disposable replacement vault';
  const original = await createVault(password), replacement = await createVault(password);
  const workspace = useWorkspace();
  workspace.network = NetworkSchema.parse({ chainId: dao.chainId, interfaceVersion: 1, rpcUrl: 'https://rpc.example', runtime: dao.contract, hub: null, environment: 'testnet', coreVersion: '0.15.0-alpha.30', capabilities: ['trusted-contact-recovery-v1'] });
  const account = AccountSchema.parse({ id: '11111111-1111-4111-8111-111111111111', custody: 'user-controlled', signingKey: replacement.signingPublicKey, encryptionKey: replacement.encryptionPublicKey });
  workspace.account = account; saveVault(replacement);
  vi.spyOn(api, 'challenge').mockResolvedValue({ id: crypto.randomUUID(), message: 'disposable login challenge', expires: new Date(Date.now() + 300000).toISOString() });
  vi.spyOn(api, 'login').mockResolvedValue(account);
  await unlockAndLogin(password, account);
  const epoch = crypto.getRandomValues(new Uint8Array(32));
  const records = empty();
  records.epochs.push({ epoch: '1', commitment: await sha256Hex(epoch), creator: '1' });
  records.keyGrants.push({ id: '1', epoch: '1', recipient: '1', grantor: '1', envelope: JSON.stringify(await createEpochGrant(original.encryptionPublicKey, epoch, epochGrantDomain(dao, '1', '1'))) });
  const grant = await createEpochGrant(replacement.encryptionPublicKey, epoch, epochGrantDomain(dao, '1', '1'));
  const prepared = await preparePrivateFile(new TextEncoder().encode('# Recovered private agreement'), metadata, epoch, contentDomain(dao, '42', 1, '1'));
  vi.spyOn(api, 'documentBytes').mockResolvedValue({ content: prepared.content });
  return { records, grant, prepared };
}

it('uses an additional recovered grant without changing the original epoch grant', async () => {
  const fixture = await recoveredFixture();
  const before = JSON.stringify(fixture.records.keyGrants);
  const recovered = vi.spyOn(api, 'contactRecoveryGrant').mockResolvedValue({ grant: fixture.grant });
  expect((await readDocumentForReview(dao, '1', document(fixture.prepared), fixture.records)).markdown).toBe('# Recovered private agreement');
  expect(recovered).toHaveBeenCalledWith({ target: { dao, memberId: '1' }, epoch: '1' });
  expect(JSON.stringify(fixture.records.keyGrants)).toBe(before);
});

it('refuses unavailable historical keys and does not invent them from future access', async () => {
  const fixture = await recoveredFixture();
  vi.spyOn(api, 'contactRecoveryGrant').mockResolvedValue({ grant: null });
  fixture.records.epochs.push({ epoch: '2', commitment: '22'.repeat(32), creator: '1' });
  await expect(readDocumentForReview(dao, '1', document(fixture.prepared), fixture.records)).rejects.toThrow('EPOCH_UNAVAILABLE');
});

it('rejects an in-flight recovered grant after the vault locks', async () => {
  const fixture = await recoveredFixture();
  let deliver: ((value: { grant: typeof fixture.grant }) => void) | undefined;
  const requested = vi.spyOn(api, 'contactRecoveryGrant').mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
  const opening = readDocumentForReview(dao, '1', document(fixture.prepared), fixture.records);
  const rejected = expect(opening).rejects.toThrow('VAULT_LOCKED');
  await vi.waitFor(() => expect(requested).toHaveBeenCalled());
  lockVault();
  if (!deliver) throw new Error('FIXTURE_DELIVERY');
  deliver({ grant: fixture.grant });
  await rejected;
});
