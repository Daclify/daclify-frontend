import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function checkRequirementRegister(root: string, register: unknown): number {
  if (!record(register) || !Array.isArray(register.requirements))
    throw new Error('REQUIREMENTS_SHAPE: register must list requirements');
  if (register.requirements.length === 0)
    throw new Error('REQUIREMENTS_EMPTY: the requirement register has no requirements');
  for (const entry of register.requirements) {
    if (!record(entry) || typeof entry.id !== 'string' || !Array.isArray(entry.tests))
      throw new Error('REQUIREMENTS_SHAPE: requirement fields are missing');
    if (entry.tests.length === 0) throw new Error(`REQUIREMENT_TEST_EMPTY: ${entry.id}`);
    for (const testPath of entry.tests) {
      if (typeof testPath !== 'string' || testPath.length === 0 || testPath.includes('..'))
        throw new Error(`REQUIREMENT_PATH: ${String(testPath)}`);
      const absolute = path.resolve(root, testPath);
      if (path.relative(root, absolute).startsWith('..'))
        throw new Error(`REQUIREMENT_PATH: ${testPath}`);
      if (!existsSync(absolute)) throw new Error(`REQUIREMENT_TEST_MISSING: ${testPath}`);
      const source = readFileSync(absolute, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (!/\b(?:it|test)\s*\(/.test(source))
        throw new Error(`REQUIREMENT_TEST_EMPTY: ${testPath}`);
    }
  }
  return register.requirements.length;
}

export function loadRequirementRegister(root: string): number {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(root, 'docs/releases/requirements.json'), 'utf8'),
  );
  return checkRequirementRegister(root, parsed);
}
