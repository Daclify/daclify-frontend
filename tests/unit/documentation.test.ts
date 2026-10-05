import { describe, it, expect } from 'vitest';
import { HelpBundleSchema, NetworkSchema, ModuleManifestSchema } from '@daclify/core-protocol';
import { ModuleStateSchema } from '@daclify/modules';
import { documentationBundles, documentationStatus, searchGuides } from '../../src/help/catalog';
const manifest = ModuleManifestSchema.parse({
  id: 'decide',
  version: '0.1.0-alpha.1',
  coreRange: '^0.1.0-alpha.1',
  interfaceVersion: 1,
  configVersion: 1,
  capabilities: ['ballot.create'],
  helpTopic: 'decide',
});
const core = HelpBundleSchema.parse({
  schemaVersion: 1,
  producer: 'core',
  packageVersion: '0.1.0-alpha.1',
  interfaceVersion: 1,
  topics: [
    {
      id: 'privacy',
      title: 'Private documents',
      paragraphs: ['Members need their decryption keys.'],
    },
  ],
  contracts: [],
  api: [],
  modules: [],
});
const modules = HelpBundleSchema.parse({
  ...core,
  producer: 'modules',
  topics: [
    {
      id: 'decide',
      title: 'Ballot weights',
      paragraphs: ['Credits and escrowed native stake are different weights.'],
    },
  ],
  modules: [{ manifest, configuration: {} }],
});
const network = NetworkSchema.parse({
  chainId: '11'.repeat(32),
  rpcUrl: 'http://127.0.0.1:18888',
  runtime: 'daclifycore',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: '0.1.0-alpha.1',
  capabilities: [],
});
const state = ModuleStateSchema.parse({
  dao: { chainId: network.chainId, contract: network.runtime, daoId: '1', interfaceVersion: 1 },
  modules: [
    {
      deployment: {
        id: 'decide',
        account: 'decide',
        version: '0.1.0-alpha.1',
        codeHash: '22'.repeat(32),
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
});
describe('versioned handbook catalog', () => {
  it('uses validated producer bundles and rejects duplicate topic identifiers', () => {
    expect(documentationBundles([core, modules])).toEqual([core, modules]);
    expect(() => documentationBundles([core, { ...modules, topics: core.topics }])).toThrow(
      'Duplicate help topic',
    );
    expect(() => documentationBundles([{ ...core, remoteScript: 'untrusted' }])).toThrow();
  });
  it('searches guide titles and paragraphs with all query words', () => {
    expect(searchGuides([core, modules], ' NATIVE stake ').map((topic) => topic.id)).toEqual([
      'decide',
    ]);
    expect(searchGuides([core, modules], 'decryption').map((topic) => topic.id)).toEqual([
      'privacy',
    ]);
    expect(searchGuides([core, modules], 'no result')).toEqual([]);
  });
  it('reports a mismatching connected core version instead of claiming a match', () => {
    expect(documentationStatus(core, network, undefined).state).toBe('matches');
    const result = documentationStatus(core, { ...network, coreVersion: '0.2.0' }, undefined);
    expect(result.state).toBe('mismatch');
    expect(result.messages.join(' ')).toContain('0.2.0');
  });
  it('requires actual module version and code verification for matching guidance', () => {
    expect(documentationStatus(modules, network, state, 'decide').state).toBe('matches');
    const changed = ModuleStateSchema.parse({
      ...state,
      modules: state.modules.map((module) => ({
        ...module,
        codeVerified: false,
        deployment: { ...module.deployment, version: '0.2.0' },
      })),
    });
    const result = documentationStatus(modules, network, changed, 'decide');
    expect(result.state).toBe('mismatch');
    expect(result.messages.join(' ')).toContain('0.2.0');
  });
  it('labels an unselected deployment as unconnected and checks its DAO reference', () => {
    expect(documentationStatus(modules, network, undefined, 'decide').state).toBe('unconnected');
    const other = ModuleStateSchema.parse({
      ...state,
      dao: { ...state.dao, contract: 'daclifytwo' },
    });
    expect(documentationStatus(modules, network, other, 'decide').state).toBe('mismatch');
  });
});
