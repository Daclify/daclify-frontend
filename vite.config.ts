import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { z } from 'zod';
export default defineConfig(({ mode }) => {
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
  return {
    plugins: [vue()],
    server: {
      port: uiPort,
      strictPort: true,
      proxy: { '/v1': { target: 'http://127.0.0.1:' + apiPort, changeOrigin: false } },
    },
  };
});
