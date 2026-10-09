import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION as coreVersion } from '@daclify/core-protocol';
import { VERSION as modulesVersion } from '@daclify/modules';
import { expect, it } from 'vitest';
import { z } from 'zod';

const versions = [
  { name: '@daclify/core-protocol', version: coreVersion },
  { name: '@daclify/modules', version: modulesVersion },
];
const dependencies = z.record(z.string(), z.string());
const manifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  license: z.literal('AGPL-3.0-only'),
  dependencies: dependencies.default({}),
  peerDependencies: dependencies.default({}),
  scripts: dependencies.default({}),
});

it('installs both SDKs from a complete, integrity-pinned frontend checkout', () => {
  for (const sdk of versions) {
    const root = process.cwd();
    const manifest = z
      .object({ dependencies })
      .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    const spec = manifest.dependencies[sdk.name];
    expect(spec).toMatch(/^file:vendor\/[^/]+\.tgz$/);
    if (!spec) throw new Error('SDK_DEPENDENCY_MISSING');
    const archive = join(root, spec.slice('file:'.length));
    const lock = z
      .object({
        packages: z.record(
          z.string(),
          z.object({
            version: z.string().optional(),
            resolved: z.string().optional(),
            integrity: z.string().optional(),
            dependencies: dependencies.optional(),
          }),
        ),
      })
      .parse(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')));
    expect(lock.packages['']?.dependencies?.[sdk.name]).toBe(spec);
    expect(lock.packages[`node_modules/${sdk.name}`]).toMatchObject({
      version: sdk.version,
      resolved: spec,
      integrity: `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`,
    });

    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    for (const entry of entries) {
      expect(entry.split('/')).not.toContain('..');
      expect(entry).toMatch(
        /^package\/(?:package\.json$|LICENSE$|LICENSING\.md$|README\.md$|dist\/(?:protocol|sdk|archive)\/|docs\/generated\/|contracts\/common\/|migrations\/archive\/)/,
      );
    }
    const packed = manifestSchema.parse(
      JSON.parse(
        execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }),
      ),
    );
    expect(packed).toMatchObject({ name: sdk.name, version: sdk.version });
    expect(Object.values(packed.dependencies).some((value) => value.startsWith('file:'))).toBe(
      false,
    );
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare'])
      expect(packed.scripts[hook]).toBeUndefined();
    if (sdk.name === '@daclify/modules')
      expect(packed.peerDependencies['@daclify/core-protocol']).toBe(coreVersion);
  }
});
