import * as mssql from 'mssql';
import { DatabaseAdapter, DatabaseType, QueryResult } from './adapter';

export class AzureSqlAdapter implements DatabaseAdapter {
  readonly type = DatabaseType.AZURE_SQL;
  private pool: mssql.ConnectionPool;

  constructor(connectionString: string) {
    const config = this.parseConnectionString(connectionString);
    this.pool = new mssql.ConnectionPool(config);
  }

  private getTrustServerCertificateDefault(): boolean {
    return (process.env.AZURE_SQL_TRUST_SERVER_CERTIFICATE ?? '').toLowerCase() === 'true';
  }

  private parseConnectionString(connectionString: string): mssql.config {
    if (!connectionString || typeof connectionString !== 'string') {
      throw new Error('Connection string is required and must be a string');
    }
    const trustServerCertificateDefault = this.getTrustServerCertificateDefault();
    const config: any = { options: { encrypt: true, trustServerCertificate: trustServerCertificateDefault } };
    const normalizeAzureUsername = (configToNormalize: mssql.config): void => {
      const server = configToNormalize.server;
      if (server && server.endsWith('.database.windows.net') && configToNormalize.user && !configToNormalize.user.includes('@')) {
        const serverName = server.split('.')[0];
        configToNormalize.user = `${configToNormalize.user}@${serverName}`;
        console.log(`[database] Updated Azure SQL username to ${configToNormalize.user}`);
      }
    };
    if (connectionString.includes('://')) {
      try {
        const parsed = this.parseUrlFormat(connectionString);
        if (parsed && parsed.server) {
          Object.assign(config, parsed);
          normalizeAzureUsername(config);
          return config as mssql.config;
        }
      } catch (e) {
        console.log('[database] URL parsing failed, falling back to manual parsing');
      }
    }
    let withoutPrefix = connectionString.replace(/^sqlserver:\/\//i, '').replace(/^mssql:\/\//i, '');
    const processPair = (key: string, value: string) => {
        const lowerKey = key.toLowerCase();
        let cleanValue = value.trim();
        if ((cleanValue.startsWith('{') && cleanValue.endsWith('}')) || (cleanValue.startsWith('"') && cleanValue.endsWith('"')) || (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
            cleanValue = cleanValue.substring(1, cleanValue.length - 1);
        }
        switch (lowerKey) {
            case 'server': case 'data source': case 'addr': case 'address':
                if (cleanValue.includes(',')) { const [srv, port] = cleanValue.split(','); config.server = srv.trim(); config.port = parseInt(port.trim(), 10); }
                else if (cleanValue.includes(':')) { const [srv, port] = cleanValue.split(':'); config.server = srv.trim(); config.port = parseInt(port.trim(), 10); }
                else { config.server = cleanValue; }
                break;
            case 'database': case 'initial catalog': config.database = cleanValue; break;
            case 'user': case 'uid': case 'user id': case 'username': config.user = cleanValue; break;
            case 'password': case 'pwd': config.password = cleanValue; break;
            case 'encrypt': config.options.encrypt = cleanValue.toLowerCase() === 'true'; break;
            case 'trustservercertificate': config.options.trustServerCertificate = cleanValue.toLowerCase() === 'true'; break;
        }
    };
    const rawParts = withoutPrefix.split(';');
    let currentKey = ''; let currentValue = '';
    for (let i = 0; i < rawParts.length; i++) {
        const part = rawParts[i];
        let insideQuote = false;
        if (currentKey && currentValue) {
            const trimmedVal = currentValue.trim();
            if ((trimmedVal.startsWith("'") && !trimmedVal.endsWith("'")) || (trimmedVal.startsWith('"') && !trimmedVal.endsWith('"')) || (trimmedVal.startsWith('{') && !trimmedVal.endsWith('}'))) insideQuote = true;
            if (trimmedVal === "'" || trimmedVal === '"' || trimmedVal === '{') insideQuote = true;
        }
        if (insideQuote) { currentValue += ';' + part; continue; }
        const equalIndex = part.indexOf('=');
        if (equalIndex > 0) {
             if (currentKey) processPair(currentKey, currentValue);
             currentKey = part.substring(0, equalIndex).trim();
             currentValue = part.substring(equalIndex + 1);
        } else {
            if (currentKey) { currentValue += ';' + part; }
            else if (i === 0 && !config.server) {
                const firstPart = part.trim();
                if (firstPart) {
                   if (firstPart.includes(':')) {
                       const lastColonIndex = firstPart.lastIndexOf(':');
                       config.server = firstPart.substring(0, lastColonIndex);
                       config.port = parseInt(firstPart.substring(lastColonIndex + 1), 10) || 1433;
                   } else { config.server = firstPart; config.port = 1433; }
                }
            }
        }
    }
    if (currentKey) processPair(currentKey, currentValue);
    if (!config.server) throw new Error('Invalid connection string: server is required.');
    if (config.server.toLowerCase().startsWith('tcp:')) config.server = config.server.substring(4);
    normalizeAzureUsername(config);
    return config as mssql.config;
  }

  private parseUrlFormat(connectionString: string): mssql.config | null {
    try {
      const normalizedString = connectionString.replace(/^sqlserver:/i, 'mssql:');
      const url = new URL(normalizedString);
      if (url.protocol !== 'mssql:') return null;
      const parsedConfig: any = { server: url.hostname, user: url.username, password: url.password, options: { encrypt: true, trustServerCertificate: this.getTrustServerCertificateDefault() } };
      if (url.port) parsedConfig.port = parseInt(url.port, 10);
      const database = url.pathname ? url.pathname.replace(/^\//, '') : '';
      if (database) parsedConfig.database = database;
      url.searchParams.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'encrypt') parsedConfig.options.encrypt = value.toLowerCase() === 'true';
        else if (lowerKey === 'trustservercertificate') parsedConfig.options.trustServerCertificate = value.toLowerCase() === 'true';
        else if (lowerKey === 'database') parsedConfig.database = value;
      });
      return parsedConfig as mssql.config;
    } catch (error) { return null; }
  }

  private buildMergeStatement(table: string, insertClause: string, conflictColumn: string, updateSet: string): string {
    const insertMatch = insertClause.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (!insertMatch) return '';
    const columns = insertMatch[1].split(',').map((col) => col.trim());
    const values = insertMatch[2].split(',').map((value) => value.trim());
    const sourceSelect = columns.map((column, index) => `${values[index]} AS ${column}`).join(', ');
    const insertColumns = columns.join(', ');
    const insertValues = columns.map((column) => `source.${column}`).join(', ');
    const updateSetSql = updateSet.replace(/EXCLUDED\./g, 'source.');
    return `MERGE ${table} AS target USING (SELECT ${sourceSelect}) AS source ON (target.${conflictColumn.trim()} = source.${conflictColumn.trim()}) WHEN MATCHED THEN UPDATE SET ${updateSetSql} WHEN NOT MATCHED THEN INSERT (${insertColumns}) VALUES (${insertValues});`;
  }

  async connect(): Promise<void> {
    if (!this.pool.connected) { await this.pool.connect(); console.info('[database] connected to Azure SQL'); }
  }

  async query<T>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    await this.connect();
    let convertedSql = sql;
    const request = this.pool.request();
    if (params && params.length > 0) {
      params.forEach((value, index) => {
        const paramName = `p${index + 1}`;
        // Fixed regex: removed extra backslashes from review feedback
        convertedSql = convertedSql.replace(new RegExp(`\\$${index + 1}(?![0-9])`, 'g'), `@${paramName}`);
        request.input(paramName, value);
      });
    }
    convertedSql = convertedSql
      .replace(/CREATE TABLE IF NOT EXISTS (\w+) \(/g, (match, tableName) => `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[${tableName}]') AND type in (N'U')) CREATE TABLE ${tableName} (`)
      .replace(/INSERT INTO (\w+) (.+) ON CONFLICT \((.+)\) DO UPDATE SET (.+)/g, (match, table, cols, conflictCol, updateSet) => this.buildMergeStatement(table, cols, conflictCol, updateSet) || match);

    try {
      const result = await request.query(convertedSql);
      return { rows: result.recordset as T[], rowCount: result.rowsAffected[0] || 0 };
    } catch (error) { console.error('[database] Azure SQL query error:', error); console.error('SQL:', convertedSql); throw error; }
  }

  async close(): Promise<void> { await this.pool.close(); console.info('[database] Azure SQL pool closed'); }
  getPool(): mssql.ConnectionPool { return this.pool; }
  getPlaceholder(index: number): string { return `@p${index}`; }
  getMaxParameters(): number { return 2000; }
  getLimitOffsetSql(limit: number, offset?: number): string { return offset === undefined ? '' : `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`; }
  getTopSql(limit: number): string { return `TOP (${limit})`; }
  getIlikeSql(column: string, placeholder: string): string { return `${column} LIKE ${placeholder}`; }
  getNowSql(): string { return 'SYSUTCDATETIME()'; }
  getDateMinusIntervalSql(amount: number, unit: 'day' | 'hour' | 'minute'): string { return `DATEADD(${unit}, -${amount}, GETUTCDATE())`; }
  getEpochMsSql(column: string | 'NOW'): string {
    const target = column === 'NOW' ? 'GETUTCDATE()' : column;
    return `DATEDIFF_BIG(ms, '1970-01-01', ${target})`;
  }
  getUpsertSql(table: string, columns: string[], conflictColumn: string, updateColumns: string[]): string {
    const sourceSelect = columns.map((col, i) => `@p${i + 1} AS ${col}`).join(', ');
    const insertColumns = columns.join(', ');
    const insertValues = columns.map(col => `source.${col}`).join(', ');
    const updateSet = updateColumns.map(col => `target.${col} = source.${col}`).join(', ');
    return `MERGE ${table} AS target USING (SELECT ${sourceSelect}) AS source ON (target.${conflictColumn} = source.${conflictColumn}) WHEN MATCHED THEN UPDATE SET ${updateSet} WHEN NOT MATCHED THEN INSERT (${insertColumns}) VALUES (${insertValues});`;
  }
  getArrayInSql(column: string, placeholders: string[]): string { return `${column} IN (${placeholders.join(', ')})`; }
  getCreateTableIfNotExistsSql(table: string, columns: string): string { return `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[${table}]') AND type in (N'U')) CREATE TABLE ${table} (${columns})`; }
  getCreateIndexIfNotExistsSql(indexName: string, table: string, columns: string, unique?: boolean): string { return `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = '${indexName}') CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${indexName} ON ${table} (${columns})`; }
  getSubstringAfterSql(column: string, char: string): string { return `SUBSTRING(${column}, CHARINDEX('${char}', ${column}) + 1, LEN(${column}))`; }
}
