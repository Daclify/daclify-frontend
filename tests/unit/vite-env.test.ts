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

it('configures local HTTPS with a certificate pair and an explicit developer hostname', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'daclify-vite-https-'));
  try {
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    writeFileSync(path.join(directory, 'cert.pem'), 'synthetic-certificate');
    writeFileSync(path.join(directory, 'key.pem'), 'synthetic-key');
    vi.stubEnv('DACLIFY_TEST_HTTPS_CERT', path.join(directory, 'cert.pem'));
    vi.stubEnv('DACLIFY_TEST_HTTPS_KEY', path.join(directory, 'key.pem'));
    vi.stubEnv('DACLIFY_TEST_HOST', 'dev.app.example');
    const read = (command: 'serve' | 'build') =>
      typeof config === 'function' ? config({ mode: 'testnet', command }) : config;
    const server = (await read('serve')).server;
    expect(server?.https).toMatchObject({
      cert: Buffer.from('synthetic-certificate'),
      key: Buffer.from('synthetic-key'),
    });
    expect(server?.allowedHosts).toEqual(['dev.app.example']);
    vi.stubEnv('DACLIFY_TEST_HTTPS_KEY', undefined);
    await expect(async () => read('serve')).rejects.toThrow('DEV_HTTPS_CONFIGURATION_INVALID');
    expect((await read('build')).server?.https).toBeUndefined();
    vi.stubEnv('DACLIFY_TEST_HOST', 'true');
    await expect(async () => read('serve')).rejects.toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
