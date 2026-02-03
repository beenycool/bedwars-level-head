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
}

