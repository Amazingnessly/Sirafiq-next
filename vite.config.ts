import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const useRemoteBindings = process.env.SIRAFIQ_REMOTE_BINDINGS === '1';

export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings: useRemoteBindings })],
  build: {
    // Vite 8 defaults to Safari/iOS 16.4. Sirāfiq is intentionally built
    // down to ES2019 so older iPads with native ESM can still boot the app.
    target: 'es2019',
  },
});
