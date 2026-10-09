import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanSource, scanTree } from '../../tools/lint.js';
import { checkRequirementRegister, loadRequirementRegister } from '../../tools/requirements.js';

const anyType = ['an', 'y'].join('');
const directive = ['@ts', 'expect-error'].join('-');
const unknownType = ['unk', 'nown'].join('');

describe('frontend lint and requirement register', () => {
  it('rejects explicit any, suppressions, non-null assertions, and unknown casts', () => {
    expect(
      scanSource('probe.ts', `export const value: ${anyType} = 1;\n`).map((row) => row.rule),
    ).toContain('explicit-any');
    expect(
      scanSource('probe.ts', `// ${directive} hidden\nexport const value = 1;\n`).map(
        (row) => row.rule,
      ),
    ).toContain('ts-suppression');
    expect(
      scanSource(
        'probe.vue',
        `<script setup lang="ts">\nexport const value: ${anyType} = 1;\n</script>\n`,
      ).map((row) => row.rule),
    ).toContain('explicit-any');
    expect(
      scanSource('probe.ts', 'export const value = input!;\n').map((row) => row.rule),
    ).toContain('non-null-assertion');
    expect(
      scanSource('probe.ts', `export const value = 1 as ${unknownType};\n`).map((row) => row.rule),
    ).toContain('unchecked-unknown-cast');
    expect(scanSource('probe.ts', 'export const value = 1;\n')).toEqual([]);
  });

  it('accepts this repository source', () => {
    expect(scanTree(process.cwd())).toEqual([]);
  });

  it('rejects an empty register and a missing test', () => {
    const root = mkdtempSync(join(tmpdir(), 'daclify-frontend-requirements-'));
    expect(() => checkRequirementRegister(root, { requirements: [] })).toThrow(
      'REQUIREMENTS_EMPTY',
    );
    expect(() =>
      checkRequirementRegister(root, {
        requirements: [{ id: 'MISSING', tests: ['missing.test.ts'] }],
      }),
    ).toThrow('REQUIREMENT_TEST_MISSING');
    writeFileSync(join(root, 'empty.test.ts'), 'describe("empty", () => {});\n');
    expect(() =>
      checkRequirementRegister(root, { requirements: [{ id: 'EMPTY', tests: ['empty.test.ts'] }] }),
    ).toThrow('REQUIREMENT_TEST_EMPTY');
  });

  it('accepts the committed register', () => {
    expect(loadRequirementRegister(process.cwd())).toBeGreaterThan(0);
  });

  it('recognises test calls without confusing URL globs or strings for comments and tests', () => {
    const root = mkdtempSync(join(tmpdir(), 'daclify-frontend-requirements-'));
    const register = { requirements: [{ id: 'URL-GLOBS', tests: ['routes.spec.ts'] }] };
    writeFileSync(
      join(root, 'routes.spec.ts'),
      'const glob = "**/v1/**"; test("route", () => { const other = "**/docs/**"; });',
    );
    expect(checkRequirementRegister(root, register)).toBe(1);
    writeFileSync(join(root, 'routes.spec.ts'), 'const example = \'test("fake", () => {})\';');
    expect(() => checkRequirementRegister(root, register)).toThrow('REQUIREMENT_TEST_EMPTY');
  });
});
