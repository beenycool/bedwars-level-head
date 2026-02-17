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

  // Dialect-specific SQL generation
  getPlaceholder(index: number): string;
  getMaxParameters(): number;
  getLimitOffsetSql(limit: number, offset?: number): string;
  getTopSql(limit: number): string;
  getIlikeSql(column: string, placeholder: string): string;
  getNowSql(): string;
  getDateMinusIntervalSql(amount: number, unit: 'day' | 'hour' | 'minute'): string;
  getEpochMsSql(column: string | 'NOW'): string;
  getUpsertSql(table: string, columns: string[], conflictColumn: string, updateColumns: string[]): string;
  getArrayInSql(column: string, placeholders: string[]): string;
  getCreateTableIfNotExistsSql(table: string, columns: string): string;
  getCreateIndexIfNotExistsSql(indexName: string, table: string, columns: string, unique?: boolean): string;
  getSubstringAfterSql(column: string, char: string): string;
}
