import express, { Express } from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import helmet from 'helmet';
import { requestId } from '../../src/middleware/requestId';

async function makeRequest(app: Express, method: string, path: string) {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;

  const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        method,
        path,
        port: address.port,
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  return response;
}

describe('Middleware Integration', () => {
  it('should include X-Request-ID in response headers', async () => {
    const app = express();
    app.use(requestId);
    app.get('/test', (_req, res) => res.send('ok'));

    const response = await makeRequest(app, 'GET', '/test');
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should include security headers from Helmet and custom ones', async () => {
    const app = express();
    app.use(helmet({
      frameguard: { action: 'deny' }
    }));
    app.use((_req, res, next) => {
      res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()');
      next();
    });
    app.get('/test', (_req, res) => res.send('ok'));

    const response = await makeRequest(app, 'GET', '/test');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['permissions-policy']).toBe('geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()');
  });
});
