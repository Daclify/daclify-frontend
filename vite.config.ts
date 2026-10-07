import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'DACLIFY_TEST_');
  const uiPort = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(env.DACLIFY_TEST_UI_PORT ?? 5178);
  const apiPort = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(env.DACLIFY_TEST_API_PORT ?? 3008);
  const cert = command === 'serve' ? env.DACLIFY_TEST_HTTPS_CERT : undefined;
  const key = command === 'serve' ? env.DACLIFY_TEST_HTTPS_KEY : undefined;
  if (!!cert !== !!key) throw new Error('DEV_HTTPS_CONFIGURATION_INVALID');
  const host =
    command === 'serve' && env.DACLIFY_TEST_HOST
      ? z
          .string()
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/)
          .parse(env.DACLIFY_TEST_HOST)
      : undefined;
  return {
    plugins: [vue()],
    server: {
      port: uiPort,
      strictPort: true,
      ...(host ? { allowedHosts: [host] } : {}),
      ...(cert && key ? { https: { cert: readFileSync(cert), key: readFileSync(key) } } : {}),
      proxy: { '/v1': { target: 'http://127.0.0.1:' + apiPort, changeOrigin: false } },
    },
  };
});
