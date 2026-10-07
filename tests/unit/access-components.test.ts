import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
it('isolates real Vue component state and offers only contract-authorized actions', () => {
  expect(
    execFileSync(process.execPath, ['tools/check-access.mjs'], { encoding: 'utf8' }),
  ).toContain('"reviewButtonPresent":true');
}, 20000);
