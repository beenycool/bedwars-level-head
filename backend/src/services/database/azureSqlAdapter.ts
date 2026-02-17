import * as mssql from 'mssql';
import { DatabaseAdapter, DatabaseType, QueryResult } from './adapter';
import { logger } from '../../util/logger';

export class AzureSqlAdapter implements DatabaseAdapter {
  readonly type = DatabaseType.AZURE_SQL;
  private pool: mssql.ConnectionPool;

  constructor(connectionString: string) {
    const config = this.parseConnectionString(connectionString);
    logger.info('[database] Azure SQL config parsed:', {
      server: config.server,
      port: config.port,
      database: config.database,
      user: config.user,
      hasPassword: !!config.password,
      trustServerCertificate: config.options?.trustServerCertificate,
      serverType: typeof config.server
    });
    this.pool = new mssql.ConnectionPool(config);
  }

  private parseConnectionString(connectionString: string): mssql.config {
    const urlConfig = this.parseUrlFormat(connectionString);
    if (urlConfig) return urlConfig;

    const config: any = {
      options: {
        encrypt: true,
        trustServerCertificate: false
      }
    };

    const normalizeAzureUsername = (configToNormalize: mssql.config): void => {
      const server = configToNormalize.server;
      if (server && server.endsWith('.database.windows.net') && configToNormalize.user && !configToNormalize.user.includes('@')) {
        const serverName = server.split('.')[0];
        configToNormalize.user = `${configToNormalize.user}@${serverName}`;
        logger.info(`[database] Updated Azure SQL username to ${configToNormalize.user}`);
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
        // Ignore URL parse error and fall back to manual parsing
        logger.info('[database] URL parsing failed, falling back to manual parsing');
      }
    }
    let withoutPrefix = connectionString.replace(/^sqlserver:\/\//i, '').replace(/^mssql:\/\//i, '');
    const processPair = (key: string, value: string) => {
        const lowerKey = key.toLowerCase();
        let cleanValue = value.trim();
        
        if ((cleanValue.startsWith('{') && cleanValue.endsWith('}')) || 
            (cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
            (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
            cleanValue = cleanValue.substring(1, cleanValue.length - 1);
        }
        switch (lowerKey) {
            case 'server':
            case 'data source':
            case 'addr':
            case 'address':
                if (cleanValue.includes(',')) {
                    const [srv, port] = cleanValue.split(',');
                    config.server = srv.trim();
                    config.port = parseInt(port.trim(), 10);
                } else if (cleanValue.includes(':')) {
                    const [srv, port] = cleanValue.split(':');
                    config.server = srv.trim();
                    config.port = parseInt(port.trim(), 10);
                } else {
                    config.server = cleanValue;
                }
                break;
            case 'database':
            case 'initial catalog':
                config.database = cleanValue;
                break;
            case 'user':
            case 'uid':
            case 'user id':
            case 'username':
                config.user = cleanValue;
                break;
            case 'password':
            case 'pwd':
                config.password = cleanValue;
                break;
            case 'encrypt':
                config.options.encrypt = cleanValue.toLowerCase() === 'true';
                break;
            case 'trustservercertificate':
                config.options.trustServerCertificate = cleanValue.toLowerCase() === 'true';
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
            if (trimmedVal.startsWith("'") && !trimmedVal.endsWith("'")) insideQuote = true;
            else if (trimmedVal.startsWith('"') && !trimmedVal.endsWith('"')) insideQuote = true;
            else if (trimmedVal.startsWith('{') && !trimmedVal.endsWith('}')) insideQuote = true;
            if (trimmedVal === "'" || trimmedVal === '"' || trimmedVal === '{') insideQuote = true;
        }
        if (insideQuote) { currentValue += ';' + part; continue; }
        const equalIndex = part.indexOf('=');
        if (equalIndex > 0) {
             if (currentKey) processPair(currentKey, currentValue);
             currentKey = part.substring(0, equalIndex).trim();
             currentValue = part.substring(equalIndex + 1);
        } else {
            if (currentKey) {
                currentValue += ';' + part;
            } else if (i === 0 && !config.server) {
                const firstPart = part.trim();
                if (firstPart) {
                   if (firstPart.includes(':')) {
                       const lastColonIndex = firstPart.lastIndexOf(':');
                       config.server = firstPart.substring(0, lastColonIndex);
                       config.port = parseInt(firstPart.substring(lastColonIndex + 1), 10) || 1433;
                   } else {
                       config.server = firstPart;
                       config.port = 1433;
                   }
                }
            }
        }
    }
    if (currentKey) processPair(currentKey, currentValue);

    if (config.server?.toLowerCase().startsWith('tcp:')) {
        config.server = config.server.substring(4);
    }

    logger.info(`[database] Password provided: ${!!config.password}`);

    // Azure SQL specific fix: Ensure username is in user@server format if not already
    // This is often required for Azure SQL Database
    normalizeAzureUsername(config);
    return config as mssql.config;
  }

  private parseUrlFormat(connectionString: string): mssql.config | null {
    try {
      const normalizedString = connectionString.replace(/^sqlserver:/i, 'mssql:');
      const url = new URL(normalizedString);
      if (url.protocol !== 'mssql:') return null;

      const parsedConfig: any = {
        server: url.hostname,
        user: url.username,
        password: url.password,
        options: {
          encrypt: true,
          trustServerCertificate: false
        }
      };

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
    } catch {
      return null;
    }
  }

  async connect(): Promise<void> {
    if (!this.pool.connected) {
      await this.pool.connect();
      logger.info('[database] connected to Azure SQL');
    }
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

    try {
      const result = await request.query(convertedSql);
      return {
        rows: result.recordset as T[],
        rowCount: result.rowsAffected[0] || 0,
      };
    } catch (error) {
      logger.error('[database] Azure SQL query error:', error);
      logger.error('SQL:', convertedSql);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.close();
    logger.info('[database] Azure SQL pool closed');
  }
  getUpsertSql(table: string, columns: string[], conflictColumn: string, updateColumns: string[]): string {
    const sourceSelect = columns.map((col, i) => `@p${i + 1} AS ${col}`).join(', ');
    const insertColumns = columns.join(', ');
    const insertValues = columns.map(col => `source.${col}`).join(', ');
    const updateSet = updateColumns.map(col => `target.${col} = source.${col}`).join(', ');
    return `MERGE ${table} AS target USING (SELECT ${sourceSelect}) AS source ON (target.${conflictColumn} = source.${conflictColumn}) WHEN MATCHED THEN UPDATE SET ${updateSet} WHEN NOT MATCHED THEN INSERT (${insertColumns}) VALUES (${insertValues});`;
  }

  getPaginationFragment(limit: number | string, offset?: number | string): string {
    const offsetValue = offset !== undefined ? offset : 0;
    return `OFFSET ${offsetValue} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  }

  getIlikeFragment(column: string, placeholder: string): string {
    return `${column} LIKE ${placeholder}`;
  }

  formatInClause(column: string, values: any[], startIndex: number): { sql: string; params: any[] } {
    const placeholders = values.map((_, i) => `$${startIndex + i}`).join(', ');
    return {
      sql: `${column} IN (${placeholders})`,
      params: values,
    };
  }

  getUpsertQuery(table: string, columns: string[], conflictColumn: string, updateColumns: string[]): string {
    const colList = columns.join(', ');
    const sourceSelect = columns.map((col, i) => `$${i + 1} AS ${col}`).join(', ');
    const updateList = updateColumns.map((col) => `target.${col} = source.${col}`).join(', ');
    const insertValues = columns.map((col) => `source.${col}`).join(', ');

    return `
      MERGE ${table} AS target
      USING (SELECT ${sourceSelect}) AS source
      ON (target.${conflictColumn} = source.${conflictColumn})
      WHEN MATCHED THEN
        UPDATE SET ${updateList}
      WHEN NOT MATCHED THEN
        INSERT (${colList})
        VALUES (${insertValues});
    `;
  }

  getMaxParameters(): number {
    return 2000;
  }

  getPurgeSql(table: string, column: string, days: number): string {
    return `DELETE FROM ${table} WHERE ${column} < DATEADD(day, -${days}, GETDATE())`;
  }

  getRecentApiCallsSql(intervalMs: number): string {
    const seconds = Math.floor(intervalMs / 1000);
    return `SELECT count(*) as count FROM hypixel_api_calls WHERE called_at >= (DATEDIFF_BIG(ms, '1970-01-01', DATEADD(second, -${seconds}, GETDATE())))`;
  }

  getActivePrivateUserCountSql(sincePlaceholder: string): string {
    return `SELECT COUNT(DISTINCT SUBSTRING([key], CHARINDEX(':', [key]) + 1, LEN([key]))) AS count FROM rate_limits WHERE [key] LIKE 'private:%' AND window_start >= ${sincePlaceholder}`;
  }

  getPrivateRequestCountSql(sincePlaceholder: string): string {
    return `SELECT COALESCE(SUM(count), 0) AS total FROM rate_limits WHERE [key] LIKE 'private:%' AND window_start >= ${sincePlaceholder}`;
  }
}
