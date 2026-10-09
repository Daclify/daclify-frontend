import { HelpBundleSchema, type HelpBundle, type Network } from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';

const guideGroups = [
  {
    id: 'getting-started',
    title: 'Getting started',
    description: 'Find a community, set up your account and choose how to run your DAO.',
    topicIds: ['dao-discovery', 'accounts', 'deployments', 'dao-presets', 'docs-assistant'],
  },
  {
    id: 'governance',
    title: 'Members & governance',
    description: 'Understand membership, voting, elections and executive responsibilities.',
    topicIds: [
      'members',
      'dao-governance',
      'executives',
      'endorsement-admission',
      'representative-elections',
      'agents',
    ],
  },
  {
    id: 'modules',
    title: 'Modules & treasury',
    description: 'Choose tools for decisions, projects, grants and payments from your treasury.',
    topicIds: [
      'modules',
      'marketplace',
      'decide',
      'works',
      'governed-funding',
      'grants-rounds',
      'contribution-agreements',
      'payroll',
      'treasury',
      'spending-reports',
    ],
  },
  {
    id: 'costs',
    title: 'Costs & storage',
    description: 'Plan member capacity, understand charges and keep your DAO resources funded.',
    topicIds: [
      'creation-fees',
      'shared-hosting',
      'resources-and-retention',
      'retention',
      'payments',
      'service-payment',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy & recovery',
    description: 'Protect documents, back up your keys and understand what can be recovered.',
    topicIds: ['privacy', 'documents', 'recovery', 'archive'],
  },
  {
    id: 'operators',
    title: 'Operators & reference',
    description:
      'Run an independent deployment, configure services and check contract permissions.',
    topicIds: [
      'independent-operators',
      'providers',
      'platform',
      'contract-permissions',
      'release-0.5',
      'module-reference',
      'license',
    ],
  },
];

export function groupGuides(topics: HelpBundle['topics']) {
  const groups = guideGroups.map(({ id, title, description, topicIds }) => ({
    id,
    title,
    description,
    topics: topicIds.flatMap((id) => topics.filter((topic) => topic.id === id)),
  }));
  const known = new Set(guideGroups.flatMap((group) => group.topicIds));
  const remaining = topics.filter((topic) => !known.has(topic.id));
  if (remaining.length)
    groups.push({
      id: 'more-guides',
      title: 'More guides',
      description: 'Additional guides included with this release.',
      topics: remaining,
    });
  return groups.filter((group) => group.topics.length);
}

export function documentationBundles(inputs: ReadonlyArray<unknown>): HelpBundle[] {
  const bundles = inputs.map((input) => HelpBundleSchema.parse(input));
  const topics = bundles.flatMap((bundle) => bundle.topics.map((topic) => topic.id));
  if (new Set(topics).size !== topics.length) throw new Error('Duplicate help topic');
  if (new Set(bundles.map((bundle) => bundle.producer)).size !== bundles.length)
    throw new Error('Duplicate help producer');
  return bundles;
}
export function searchGuides(
  bundles: ReadonlyArray<HelpBundle>,
  query: string,
): HelpBundle['topics'] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return bundles
    .flatMap((bundle) => bundle.topics)
    .filter((topic) => {
      const text = [topic.title, ...topic.paragraphs].join(' ').toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    });
}
export function documentationStatus(
  bundle: HelpBundle,
  network: Network | undefined,
  modules: ModuleState | undefined,
  topicId?: string,
): { state: 'matches' | 'mismatch' | 'unconnected'; messages: string[] } {
  if (!network)
    return {
      state: 'unconnected',
      messages: ['No connected deployment has been verified for this guide.'],
    };
  const messages: string[] = [];
  if (network.interfaceVersion !== bundle.interfaceVersion)
    messages.push(
      `Guide interface ${bundle.interfaceVersion} differs from connected interface ${network.interfaceVersion}.`,
    );
  if (bundle.producer === 'core') {
    if (network.coreVersion !== bundle.packageVersion)
      messages.push(
        `Guide core ${bundle.packageVersion} differs from connected core ${network.coreVersion}.`,
      );
    return { state: messages.length ? 'mismatch' : 'matches', messages };
  }
  if (!modules)
    return {
      state: messages.length ? 'mismatch' : 'unconnected',
      messages: [
        ...messages,
        'Select a DAO through its module guide to verify the connected module version.',
      ],
    };
  if (modules.dao.chainId !== network.chainId || modules.dao.contract !== network.runtime)
    messages.push('The module state belongs to a different chain or runtime.');
  const references = bundle.modules.filter(
    (module) => !topicId || module.manifest.helpTopic === topicId,
  );
  for (const reference of references.length ? references : bundle.modules) {
    const installed = modules.modules.find(
      (module) => module.deployment.id === reference.manifest.id,
    );
    if (!installed) {
      messages.push(`No ${reference.manifest.id} deployment was verified for this DAO.`);
      continue;
    }
    if (installed.deployment.version !== reference.manifest.version)
      messages.push(
        `Guide ${reference.manifest.id} ${reference.manifest.version} differs from connected ${installed.deployment.version}.`,
      );
    if (!installed.compatible || !installed.codeVerified)
      messages.push(`The connected ${reference.manifest.id} code or compatibility is unverified.`);
  }
  return { state: messages.length ? 'mismatch' : 'matches', messages };
}
