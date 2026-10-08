// Executes the real Vue components with an in-memory renderer and synthetic API data.
// No browser account, private document, chain write or production service is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import {ModuleStateSchema,Catalog} from '@daclify/modules';
import { createRenderer, reactive, h, nextTick, compile, ssrContextKey } from 'vue';
import { parse, compileScript } from 'vue/compiler-sfc';
import { createPinia } from 'pinia';
const root = process.cwd();
const server = await createServer({
  root,
  cacheDir: '.artifacts/access-check-cache',
  configFile: false,
  plugins: [vue()],
  server: { middlewareMode: true, hmr: false },
});
globalThis.localStorage = { getItem: () => null };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { activeElement: null };
globalThis.Document = class Document {};
globalThis.ShadowRoot = class ShadowRoot {};
const { api } = await server.ssrLoadModule('/src/api/client.ts');
const { useWorkspace } = await server.ssrLoadModule('/src/state/workspace.ts');
const renderer = createRenderer({
  createElement: (tag) => ({
    tag,
    tagName: tag.toUpperCase(),
    props: {},
    children: [],
    parent: null,
    text: '',
    value: '',
    getRootNode: () => globalThis.document,
    get options() {
      return this.children.filter((node) => node.tag === 'option');
    },
    addEventListener() {},
    removeEventListener() {},
  }),
  createText: (text) => ({ tag: '#text', children: [], parent: null, text }),
  createComment: (text) => ({ tag: '#comment', children: [], parent: null, text: '' }),
  insert(node, parent, anchor) {
    if (node.parent) this.remove(node);
    node.parent = parent;
    const i = parent.children.indexOf(anchor);
    parent.children.splice(i < 0 ? parent.children.length : i, 0, node);
  },
  remove(node) {
    const i = node.parent?.children.indexOf(node);
    if (i >= 0) node.parent.children.splice(i, 1);
    node.parent = null;
  },
  setText: (node, text) => {
    node.text = text;
  },
  setElementText: (node, text) => {
    node.text = text;
    node.children = [];
  },
  patchProp: (node, key, _old, value) => {
    node.props[key] = value;
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
});
const nodes = (node) => [node, ...node.children.flatMap(nodes)];
const textOf = (node) => node.text + node.children.map(textOf).join(' ');
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await nextTick();
};
const reference = (id) => ({
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: id,
  interfaceVersion: 1,
});
const dao = (id) => ({
  reference: reference(id),
  title: 'DAO ' + id,
  privacy: 'public',
  token: { chainId: 'ab'.repeat(32), contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  keyEpoch: '1',
});
const member = (id) => ({
  dao: reference(id),
  memberId: '1',
  active: true,
  admin: true,
  reviewer: false,
  credits: '0',
  nonce: '0',
});
function mount(Component, props) {
  const container = { tag: 'root', children: [], text: '' };
  const app = renderer.createApp({ render: () => h(Component, props) });
  app.use(createPinia());
  app.provide(ssrContextKey, { modules: new Set() });
  app.component('RouterLink', {
    props: ['to'],
    setup:
      (_props, { slots }) =>
      () =>
        h('a', {}, slots.default?.()),
  });
  app.config.warnHandler = () => {};
  app.mount(container);
  return { container, app };
}
async function component(path) {
  const Component = (await server.ssrLoadModule(path)).default;
  const { descriptor } = parse(readFileSync(root + path, 'utf8'));
  Component.render = compile(descriptor.template.content, {
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: path }).bindings,
  });
  return Component;
}
const ContentPanel = await component('/src/components/ContentPanel.vue');
let releaseA;
api.content = (id) =>
  id === '1'
    ? new Promise((resolve) => {
        releaseA = resolve;
      })
    : Promise.resolve({
        dao: reference('2'),
        members: [],
        documents: [],
        keyGrants: [],
        epochs: [],
      });
api.storage = async () => ({ configured: false, provider: 'pinata', uploadLimit: 1 });
const props = reactive({ dao: dao('1'), member: undefined, section: 'documents' });
const content = mount(ContentPanel, props);
await flush();
props.dao = dao('2');
await flush();
releaseA({
  dao: reference('1'),
  members: [],
  documents: [
    {
      id: '1',
      document_id: '99',
      version: 1,
      author: '1',
      bytes: 2,
      metadata: 'DAO A content in DAO B',
      cid: '',
      envelope_version: 0,
      key_epoch: '0',
    },
  ],
  keyGrants: [],
  epochs: [],
});
await flush();
const staleDocument = textOf(content.container).includes('DAO A content in DAO B');
console.log(
  JSON.stringify({
    check: 'DAO switch while content loads',
    staleDocumentInNewDao: staleDocument,
    expected: false,
  }),
);
content.app.unmount();

const { vaultUnlocked } = await server.ssrLoadModule('/src/auth/session.ts');
vaultUnlocked.value = true;
api.content = async (id) => ({
  dao: reference(id),
  members: [],
  documents: [],
  keyGrants: [{ epoch: '1', recipient: '1' }],
  epochs: [{ epoch: '1' }],
});
const draftProps = reactive({
  dao: { ...dao('1'), privacy: 'encrypted-user-controlled' },
  member: member('1'),
  section: 'documents',
});
const draft = mount(ContentPanel, draftProps);
await flush();
const editor = nodes(draft.container).find(
  (node) => node.tag === 'textarea' && node.props.id === 'json-value',
);
editor.props['onUpdate:modelValue']('{"private":"DAO A only"}');
await flush();
draftProps.dao = dao('2');
draftProps.member = member('2');
await flush();
const publicEditor = nodes(draft.container).find(
  (node) => node.tag === 'textarea' && node.props.id === 'json-value',
);
const retainedPrivateDraft = publicEditor?.value === '{"private":"DAO A only"}';
console.log(
  JSON.stringify({
    check: 'private DAO to public DAO switch',
    privateDraftInPublicEditor: retainedPrivateDraft,
    expected: false,
  }),
);
draft.app.unmount();

api.content = async (id) => ({
  dao: reference(id),
  members: [{ id: '2', active: true, custody: 0, admin: false, reviewer: false, credits: '0' }],
  documents: [],
  keyGrants: [],
  epochs: [],
});
const inactive = mount(
  ContentPanel,
  reactive({ dao: dao('1'), member: { ...member('1'), active: false }, section: 'members' }),
);
await flush();
const chooser = nodes(inactive.container).find(
  (node) => node.tag === 'select' && node.props.id === 'member-target',
);
chooser?.props['onUpdate:modelValue']('2');
await flush();
const rolesButton = nodes(inactive.container).find(
  (node) => node.tag === 'button' && textOf(node).includes('Save roles'),
);
const inactiveCanSubmit = !!rolesButton && rolesButton.props.disabled === false;
console.log(
  JSON.stringify({
    check: 'inactive admin UI',
    roleChangeEnabled: inactiveCanSubmit,
    expected: false,
  }),
);
inactive.app.unmount();

const ModulesPanel = await component('/src/components/ModulesPanel.vue');
const moduleData = ModuleStateSchema.parse({
  next: { ballots: null, projects: null, schedules: null },
  dao: reference('1'),
  modules: [
    {
      deployment: { id: 'works', account: 'works',version:'0.4.0-alpha.1',codeHash:'ab'.repeat(32) },
      manifest:Catalog.find(module=>module.id==='works'),
      enabled: true,
      compatible: true,
      codeVerified: true,
      actions: ['propose', 'accept', 'submitwork', 'review', 'cancel'],
      grants: ['reserve', 'approve', 'cancel'],
    },
  ],
  projects: [{ id: '1',dao_id:'1',creator:'1', contributor: '2', status: 1, document_id: '1', document_version: 1,milestones:['1'] }],
  milestones: [
    {
      id: '1',
      project_id: '1',dao_id:'1',due:0,reviewer:'0',
      status: 2,
      quantity: '1.0000 TLOS',
      submission_doc: '1',
      submission_version: 1,
      review_doc: '0',
      review_version: 0,
    },
  ],
  schedules: [],
  controls: [],
  executions: [],
  ballots: [],
  votes: [],
  entries: [],
});
api.moduleState = async () => moduleData;
api.treasury = async (id) => ({ dao: reference(id), obligations: [] });
const modules = mount(
  ModulesPanel,
  reactive({ dao: dao('1'), member: member('1'), section: 'works' }),
);
await flush();
const reviewButton = nodes(modules.container).find(
  (node) => node.tag === 'button' && /Review milestone/.test(textOf(node)),
);
console.log(
  JSON.stringify({
    check: 'admin without reviewer flag',
    reviewButtonPresent: !!reviewButton,
    expected: true,
  }),
);
modules.app.unmount();
let releaseModules;
api.moduleState = (id) =>
  id === '1'
    ? new Promise((resolve) => {
        releaseModules = resolve;
      })
    : Promise.resolve({ ...moduleData, dao: reference(id), projects: [], milestones: [] });
const lateProps = reactive({ dao: dao('1'), member: member('1'), section: 'works' });
const late = mount(ModulesPanel, lateProps);
await flush();
lateProps.dao = dao('2');
lateProps.member = member('2');
await flush();
releaseModules({ ...moduleData, projects: [{ ...moduleData.projects[0], id: '123456789' }] });
await flush();
const staleProject = textOf(late.container).includes('Project 123456789');
late.app.unmount();
api.moduleState = async () => ({
  ...moduleData,
  modules: moduleData.modules.map((module) => ({ ...module, actions: ['propose'] })),
});
const limited = mount(
  ModulesPanel,
  reactive({ dao: dao('1'), member: member('1'), section: 'works' }),
);
await flush();
const restrictedReview = nodes(limited.container).find(
  (node) => node.tag === 'button' && /Review milestone/.test(textOf(node)),
);
const missingGrantEnabled = !!restrictedReview && !restrictedReview.props.disabled;
limited.app.unmount();
console.log(
  JSON.stringify({
    check: 'late module read and installed action grants',
    staleProject,
    missingGrantEnabled,
  }),
);

const FilePanel = await component('/src/components/FilePanel.vue');
api.storage = async () => ({ configured: true, provider: 'pinata', uploadLimit: 5242880 });
let releaseBuffer,
  uploads = 0,
  markers = 0;
globalThis.HTMLInputElement = class {
  constructor(file) {
    this.files = { item: () => file };
  }
};
globalThis.sessionStorage = {
  getItem: () => null,
  setItem() {
    markers++;
  },
  removeItem() {},
};
api.upload = async () => {
  uploads++;
  throw new Error('Old file must not upload');
};
const delayedFile = new File(['fixture'], 'synthetic.bin', { type: 'application/octet-stream' });
delayedFile.arrayBuffer = () =>
  new Promise((resolve) => {
    releaseBuffer = resolve;
  });
const fileProps = reactive({
  dao: dao('1'),
  member: member('1'),
  content: { dao: reference('1'), documents: [], keyGrants: [], epochs: [], members: [] },
});
const filePanel = mount(FilePanel, fileProps);
await flush();
nodes(filePanel.container)
  .find((node) => node.props?.id === 'file-document-id')
  .props['onUpdate:modelValue']('1');
nodes(filePanel.container)
  .find((node) => node.props?.id === 'document-file')
  .props.onChange({ target: new globalThis.HTMLInputElement(delayedFile) });
await flush();
const sending = nodes(filePanel.container)
  .find((node) => node.tag === 'form' && node.props.onSubmit)
  .props.onSubmit({ preventDefault() {} });
filePanel.app.unmount();
releaseBuffer(new Uint8Array([1]).buffer);
await sending;
await flush();
console.log(JSON.stringify({ check: 'unmounted file preparation', uploads, markers }));

// Exercise the real branding save while its content read is invalidated.
const storageValues = new Map();
globalThis.localStorage = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, value),
};
const session = await server.ssrLoadModule('/src/auth/session.ts');
const { createVault } = await server.ssrLoadModule('/src/auth/vault.ts');
const created = await createVault('disposable audit fixture password');
session.saveVault(created);
api.challenge = async () => ({ message: 'audit fixture' });
api.login = async () => ({ id: 'fixture', signingKey: created.signingPublicKey });
await session.unlockAndLogin('disposable audit fixture password');
const finishBranding = [];
let brandingWrites = 0;
api.relay = () => {
  brandingWrites++;
  return new Promise((resolve) => { finishBranding.push(resolve); });
};
api.content = async (id) => ({ dao: reference(id), members: [], documents: [], keyGrants: [], epochs: [] });
const brandingProps = reactive({ dao: { ...dao('1'), description: '' }, member: member('1') });
const branding = mount(await component('/src/components/DaoBrandingPanel.vue'), brandingProps);
await flush();
const brandingForm = nodes(branding.container).find((node) => node.tag === 'form');
const firstSave = brandingForm.props.onSubmit({ preventDefault() {} });
const duplicateSave = brandingForm.props.onSubmit({ preventDefault() {} });
await flush();
brandingProps.dao = { ...brandingProps.dao, branding: { summary: 'Refreshed public summary' } };
await flush();
for (const finish of finishBranding) finish({ transactionId: 'ab'.repeat(32) });
await Promise.all([firstSave, duplicateSave]);
await flush();
const brandingButton = nodes(branding.container).find((node) => node.tag === 'button' && textOf(node).includes('Sign and update card'));
const brandingStillBusy = !!brandingButton.props.disabled;
branding.app.unmount();
session.lockVault();

await server.close();
assert.equal(staleDocument, false, 'A late DAO A response must not replace DAO B content');
assert.equal(retainedPrivateDraft, false, 'Private drafts must not become public DAO drafts');
assert.equal(
  inactiveCanSubmit,
  false,
  'Inactive administrators must not be offered working role changes',
);
assert.ok(reviewButton, 'Contract-authorized administrator needs the Works review action');

assert.equal(staleProject, false, 'Old module results must not cross DAO contexts');
assert.equal(missingGrantEnabled, false, 'A missing installed action cannot enable review');

assert.equal(uploads, 0, 'A pending file read must not upload after leaving its DAO');
assert.equal(markers, 0, 'A pending file read must not save an upload under another account');
assert.equal(brandingStillBusy, false, 'Refreshing branding during save must not permanently disable submission');
assert.equal(brandingWrites, 1, 'Duplicate branding submissions must not create a second signed write');
