import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { getResourceMetricsHistory } from '../src/services/resourceMetrics';
import { pool } from '../src/services/cache';

jest.mock('../src/services/cache', () => ({
  pool: {
    type: 'POSTGRESQL',
    query: jest.fn(),
  },
  DatabaseType: {
    POSTGRESQL: 'POSTGRESQL',
    AZURE_SQL: 'AZURE_SQL',
  },
}));

describe('resourceMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should respect startDate and endDate filters', async () => {
    const startDate = new Date('2026-02-09T14:51:00Z');
    const endDate = new Date('2026-02-09T15:51:00Z');

    (pool.query as any).mockResolvedValue({
      rows: [],
      rowCount: 0,
    });

    // @ts-ignore - testing new signature
    await getResourceMetricsHistory({ startDate, endDate });

    const lastCall = (pool.query as jest.Mock).mock.calls[0];
    expect(lastCall).toBeDefined();
    const sql = lastCall[0] as string;
    const params = lastCall[1] as any[];

    expect(sql).toContain('bucket_start >= $1');
    expect(sql).toContain('AND bucket_start <= $2');
    expect(params).toContain(startDate);
    expect(params).toContain(endDate);
  });
});
