import { buildIdentity } from '../src/buildIdentity';
import app from './index';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/build') {
      return new Response(JSON.stringify(buildIdentity), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store, max-age=0',
        },
      });
    }

    return app.fetch(request, env);
  },
}
