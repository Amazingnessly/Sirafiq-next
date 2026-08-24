import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const buildSha = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'local';
const buildBranch = process.env.WORKERS_CI_BRANCH ?? process.env.GITHUB_REF_NAME ?? 'local';
const appVersion = process.env.npm_package_version ?? '0.1.0';

export default defineConfig({
  plugins: [react(), cloudflare()],
  define: {
    __SIRAFIQ_BUILD_SHA__: JSON.stringify(buildSha),
    __SIRAFIQ_BUILD_BRANCH__: JSON.stringify(buildBranch),
    __SIRAFIQ_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    // Vite 8 defaults to Safari/iOS 16.4. Sirāfiq is intentionally built
    // down to ES2019 so older iPads with native ESM can still boot the app.
    target: 'es2019',
  },
});
