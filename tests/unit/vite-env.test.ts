import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import config from '../../vite.config';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('reads testnet ports from the selected env file and lets shell values override them', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'daclify-vite-env-'));
  try {
    writeFileSync(
      path.join(directory, '.env.testnet'),
      'DACLIFY_TEST_UI_PORT=5198\nDACLIFY_TEST_API_PORT=3028\n',
    );
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    vi.stubEnv('DACLIFY_TEST_UI_PORT', undefined);
    vi.stubEnv('DACLIFY_TEST_API_PORT', undefined);
    const read = () =>
      typeof config === 'function' ? config({ mode: 'testnet', command: 'serve' }) : config;
    expect((await read()).server?.port).toBe(5198);
    const proxy = (await read()).server?.proxy?.['/v1'];
    expect(typeof proxy === 'object' ? proxy.target : null).toBe('http://127.0.0.1:3028');
    vi.stubEnv('DACLIFY_TEST_UI_PORT', '5298');
    expect((await read()).server?.port).toBe(5298);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
