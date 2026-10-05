import { HelpBundleSchema, type HelpBundle, type Network } from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';
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
