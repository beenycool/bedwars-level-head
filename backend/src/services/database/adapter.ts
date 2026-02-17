export enum DatabaseType {
  POSTGRESQL = 'POSTGRESQL',
  AZURE_SQL = 'AZURE_SQL',
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface DatabaseAdapter {
  type: DatabaseType;
  query<T>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  connect(): Promise<void>;
  close(): Promise<void>;
  getPool(): any;

  // Dialect-specific SQL helpers
  getPaginationFragment(limit: number | string, offset?: number | string): string;
  getIlikeFragment(column: string, placeholder: string): string;
  formatInClause(column: string, values: any[], startIndex: number): { sql: string; params: any[] };
  getUpsertQuery(table: string, columns: string[], conflictColumn: string, updateColumns: string[]): string;
  getMaxParameters(): number;

  // High-level operation helpers
  getPurgeSql(table: string, column: string, days: number): string;
  getRecentApiCallsSql(intervalMs: number): string;
  getActivePrivateUserCountSql(sincePlaceholder: string): string;
  getPrivateRequestCountSql(sincePlaceholder: string): string;
}
