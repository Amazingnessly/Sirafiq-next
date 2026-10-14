import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import entry from '../../worker/entry';
import { denyUnauthenticatedApi, verifyCloudflareAccessJwt } from '../../worker/access';

const ID = '91919191-9191-4919-8919-919191919191';
const team = 'sirafiq-testing.cloudflareaccess.com';
const aud = 'test-cloudflare-access-audience';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-rotation-key', alg: 'RS256', use: 'sig' };

function token(claimOverrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}) {
  const encoded = (input: unknown) => Buffer.from(JSON.stringify(input)).toString('base64url');
  const header = encoded({ alg: 'RS256', kid: 'test-rotation-key', typ: 'JWT', ...headerOverrides });
  const payload = encoded({
    iss: 'https://' + team, aud, sub: 'user-id', exp: Math.floor(Date.now() / 1000) + 300, ...claimOverrides,
  });
  const content = header + '.' + payload;
  return content + '.' + sign('RSA-SHA256', Buffer.from(content), keys.privateKey).toString('base64url');
}

describe('Cloudflare Access API authentication', () => {
  it('fails closed BEFORE ANY D1 or R2 read on a remote origin, including Range', async () => {
    let databaseReads = 0;
    let objectReads = 0;
    const env = {
      DB: { prepare: () => { databaseReads++; throw Error('Must never reach DB'); } },
      FILES: { get: () => { objectReads++; throw Error('Must never reach R2'); } },
    };
    for (const [method, path] of [
      ['GET', '/api/bootstrap'],
      ['POST', '/api/subjects/upsert'],
      ['GET', '/api/resources/' + ID],
      ['GET', '/api/resource-versions/' + ID + '/blob'],
      ['POST', '/api/resource-versions/' + ID + '/multipart/create'],
      ['POST', '/api/resource-versions/' + ID + '/server-extraction'],
    ]) {
      const request = new Request('https://sirafiq.example' + path, { method, headers: { Range: 'bytes=0-9' } });
      const response = await entry.fetch(request, env as never);
      const result = await response.json() as { error: { code: string } };
      expect(response.status).toBe(503);
      expect(result.error.code).toBe('ACCESS_NOT_CONFIGURED');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(databaseReads).toBe(0);
    expect(objectReads).toBe(0);
  });

  it('returns 401 for missing or forged assertion with configured Access', async () => {
    const env = { SIRAFIQ_ACCESS_TEAM_DOMAIN: team, SIRAFIQ_ACCESS_AUD: aud };
    const missing = await denyUnauthenticatedApi(new Request('https://sirafiq.example/api/bootstrap'), env);
    expect(missing?.status).toBe(401);
    expect((await missing?.json() as { error: { code: string } }).error.code).toBe('AUTHENTICATION_REQUIRED');
    const forged = await denyUnauthenticatedApi(new Request('https://sirafiq.example/api/bootstrap', {
      headers: { 'Cf-Access-Jwt-Assertion': 'header.payload.signature' },
    }), env);
    expect(forged?.status).toBe(401);
  });

  it('verifies RSA signatures, exact audience, issuer, expiry and key identifiers', async () => {
    const keysLoader = async () => ({ keys: [publicJwk] });
    expect(await verifyCloudflareAccessJwt(token(), team, aud, keysLoader)).toBe(true);
    expect(await verifyCloudflareAccessJwt(token({ aud: 'wrong' }), team, aud, keysLoader)).toBe(false);
    expect(await verifyCloudflareAccessJwt(token({ iss: 'https://other.cloudflareaccess.com' }), team, aud, keysLoader)).toBe(false);
    expect(await verifyCloudflareAccessJwt(token({ exp: 1 }), team, aud, keysLoader)).toBe(false);
    expect(await verifyCloudflareAccessJwt(token({}, { alg: 'none' }), team, aud, keysLoader)).toBe(false);
    expect(await verifyCloudflareAccessJwt(token({}, { kid: 'other-key' }), team, aud, keysLoader)).toBe(false);
    const segments = token().split('.');
    const signedClaims = JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const tampered = segments[0] + '.' + Buffer.from(JSON.stringify({ ...signedClaims, sub: 'tampered' })).toString('base64url') + '.' + segments[2];
    expect(await verifyCloudflareAccessJwt(tampered, team, aud, keysLoader)).toBe(false);
    expect(await verifyCloudflareAccessJwt(token({ nbf: Math.floor(Date.now() / 1000) + 600 }), team, aud, keysLoader)).toBe(false);
  });

  it('exempts public build/health endpoints and plain HTTP loopback dev only', async () => {
    const env = {};
    expect(await denyUnauthenticatedApi(new Request('https://sirafiq.example/api/build'), env)).toBeNull();
    expect(await denyUnauthenticatedApi(new Request('https://sirafiq.example/api/health'), env)).toBeNull();
    expect(await denyUnauthenticatedApi(new Request('http://127.0.0.1:5173/api/bootstrap'), env)).toBeNull();
    expect((await denyUnauthenticatedApi(new Request('https://127.0.0.1:5173/api/bootstrap'), env))?.status).toBe(503);
    expect((await denyUnauthenticatedApi(new Request('http://sirafiq.example/api/bootstrap'), env))?.status).toBe(503);
  });

  it('refuses untrusted Access team domains rather than fetching arbitrary URLs', async () => {
    const response = await denyUnauthenticatedApi(new Request('https://sirafiq.example/api/bootstrap'), {
      SIRAFIQ_ACCESS_TEAM_DOMAIN: 'evil.example.com', SIRAFIQ_ACCESS_AUD: aud,
    });
    expect(response?.status).toBe(503);
  });
});
