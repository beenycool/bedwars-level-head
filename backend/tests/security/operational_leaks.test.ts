import express, { type Express } from 'express';
import http from 'http';
import { AddressInfo } from 'net';

// Mock configuration
jest.mock('../../src/config', () => {
  return {
    ADMIN_API_KEYS: ['admin-token'],
    CRON_API_KEYS: ['cron-token'],
    MONITORING_ALLOWED_CIDRS: ['127.0.0.1/32'],
    TRUST_PROXY_ENABLED: true,
    TRUST_PROXY_CIDRS: ['10.0.0.1/32'],
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX: 100,
    CACHE_DB_URL: 'postgresql://localhost:5432/test',
  };
});

// Prevent side effects from service initializations
jest.mock('../../src/services/history', () => ({}));
jest.mock('../../src/services/cache', () => ({}));
jest.mock('../../src/services/redis', () => ({}));
jest.mock('../../src/services/database/factory', () => ({}));

import { isAuthorizedMonitoring, enforceMonitoringAuth } from '../../src/middleware/monitoringAuth';
import * as rateLimit from '../../src/middleware/rateLimit';

// Mock getClientIpAddress
const getClientIpAddressSpy = jest.spyOn(rateLimit, 'getClientIpAddress');

function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/healthz', (req, res) => {
    const isAuthorized = isAuthorizedMonitoring(req);
    if (isAuthorized) {
      res.json({ status: 'ok', secret: 'operational-detail' });
    } else {
      res.json({ status: 'ok' });
    }
  });

  app.get('/metrics', enforceMonitoringAuth, (req, res) => {
    res.send('metrics-data');
  });

  app.get('/stats', enforceMonitoringAuth, (req, res) => {
    res.send('stats-data');
  });

  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ message: err.message });
  });

  return app;
}

async function makeRequest(app: Express, method: string, path: string, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;

  const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        method,
        path,
        port: address.port,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let body = data;
          try {
            body = JSON.parse(data);
          } catch {}
          resolve({
            status: res.statusCode ?? 0,
            body,
          });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));

  return response;
}

describe('Operational detail leak protection', () => {
  const app = createTestApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows access to /healthz without auth but masks details', async () => {
    getClientIpAddressSpy.mockReturnValue('1.1.1.1'); // External IP

    const response = await makeRequest(app, 'GET', '/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.body.secret).toBeUndefined();
  });

  it('allows full access to /healthz for internal IP', async () => {
    getClientIpAddressSpy.mockReturnValue('127.0.0.1'); // Internal IP

    const response = await makeRequest(app, 'GET', '/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', secret: 'operational-detail' });
  });

  it('allows full access to /healthz with admin token', async () => {
    getClientIpAddressSpy.mockReturnValue('1.1.1.1'); // External IP

    const response = await makeRequest(app, 'GET', '/healthz', {
      'Authorization': 'Bearer admin-token'
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', secret: 'operational-detail' });
  });

  it('blocks access to /metrics for external IP', async () => {
    getClientIpAddressSpy.mockReturnValue('1.1.1.1'); // External IP

    const response = await makeRequest(app, 'GET', '/metrics');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('restricted');
  });

  it('allows access to /metrics for internal IP', async () => {
    getClientIpAddressSpy.mockReturnValue('127.0.0.1'); // Internal IP

    const response = await makeRequest(app, 'GET', '/metrics');

    expect(response.status).toBe(200);
    expect(response.body).toBe('metrics-data');
  });

  it('blocks access to /stats for external IP', async () => {
    getClientIpAddressSpy.mockReturnValue('1.1.1.1'); // External IP

    const response = await makeRequest(app, 'GET', '/stats');

    expect(response.status).toBe(403);
  });

  it('allows access to /stats with cron token', async () => {
    getClientIpAddressSpy.mockReturnValue('1.1.1.1'); // External IP

    const response = await makeRequest(app, 'GET', '/stats', {
      'X-Cron-Token': 'cron-token'
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe('stats-data');
  });
});
