import * as mssql from 'mssql';
import { DatabaseAdapter, DatabaseType, QueryResult } from './adapter';

export class AzureSqlAdapter implements DatabaseAdapter {
  readonly type = DatabaseType.AZURE_SQL;
  private pool: mssql.ConnectionPool;

  constructor(connectionString: string) {
    // Parse the connection string manually for Azure SQL
    const config = this.parseConnectionString(connectionString);
    console.log('[database] Azure SQL config parsed:', {
      server: config.server,
      port: config.port,
      database: config.database,
      user: config.user,
      hasPassword: !!config.password,
      serverType: typeof config.server
    });
    this.pool = new mssql.ConnectionPool(config);
  }

  private parseConnectionString(connectionString: string): mssql.config {
    if (!connectionString || typeof connectionString !== 'string') {
      throw new Error('Connection string is required and must be a string');
    }

    const config: any = {
      options: {
        encrypt: true,
        trustServerCertificate: false
      }
    };

    // Try parsing as URL first (for mssql://user:pass@host:port/db format)
    if (connectionString.includes('://')) {
      try {
        // Replace sqlserver:// with mssql:// for URL parsing if needed, or vice versa
        // Node URL supports generic protocols.
        const url = new URL(connectionString.replace(/^sqlserver:/i, 'mssql:'));
        
        if (url.hostname) {
          config.server = url.hostname;
          if (url.port) config.port = parseInt(url.port, 10);
          if (url.username) config.user = url.username;
          if (url.password) config.password = url.password;
          if (url.pathname && url.pathname.length > 1) {
            config.database = url.pathname.substring(1);
          }
          
          // If we got a server from URL, we might be done, but let's check for query params
          url.searchParams.forEach((value, key) => {
             const lowerKey = key.toLowerCase();
             if (lowerKey === 'encrypt') config.options.encrypt = value.toLowerCase() === 'true';
             else if (lowerKey === 'trustservercertificate') config.options.trustServerCertificate = value.toLowerCase() === 'true';
             else if (lowerKey === 'database') config.database = value;
          });

          if (config.server) {
             return config as mssql.config;
          }
        }
      } catch (e) {
        // Ignore URL parse error and fall back to manual parsing
      }
    }

    // Manual parsing for ADO.NET style or simple server:port;...
    let withoutPrefix = connectionString
      .replace(/^sqlserver:\/\//i, '')
      .replace(/^mssql:\/\//i, '');

    const parts = withoutPrefix.split(';');
    
    // Helper to process key-value pairs
    const processPair = (key: string, value: string) => {
        const lowerKey = key.toLowerCase();
        switch (lowerKey) {
            case 'server':
            case 'data source':
            case 'addr':
            case 'address':
                // Handle server,port or server:port
                if (value.includes(',')) {
                    const [srv, port] = value.split(',');
                    config.server = srv.trim();
                    config.port = parseInt(port.trim(), 10);
                } else if (value.includes(':')) {
                    const [srv, port] = value.split(':');
                    config.server = srv.trim();
                    config.port = parseInt(port.trim(), 10);
                } else {
                    config.server = value;
                }
                break;
            case 'database':
            case 'initial catalog':
                config.database = value;
                break;
            case 'user':
            case 'uid':
            case 'user id':
            case 'username':
                config.user = value;
                break;
            case 'password':
            case 'pwd':
                config.password = value;
                break;
            case 'encrypt':
                config.options.encrypt = value.toLowerCase() === 'true';
                break;
            case 'trustservercertificate':
                config.options.trustServerCertificate = value.toLowerCase() === 'true';
                break;
        }
    };

    // First pass: look for key=value pairs
    let firstPartIsKeyVal = false;
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
            const key = trimmed.substring(0, equalIndex).trim();
            const value = trimmed.substring(equalIndex + 1).trim();
            processPair(key, value);
            if (parts.indexOf(part) === 0) firstPartIsKeyVal = true;
        }
    }

    // If server is not set yet, and the first part was NOT a key=value pair, assume it's the server address
    if (!config.server && !firstPartIsKeyVal && parts.length > 0) {
        const firstPart = parts[0].trim();
        if (firstPart) {
             if (firstPart.includes(':')) {
                const lastColonIndex = firstPart.lastIndexOf(':');
                config.server = firstPart.substring(0, lastColonIndex);
                const portStr = firstPart.substring(lastColonIndex + 1);
                config.port = parseInt(portStr, 10) || 1433;
            } else {
                config.server = firstPart;
                config.port = 1433;
            }
        }
    }

    // Validate required fields
    if (!config.server || typeof config.server !== 'string') {
      throw new Error(`Invalid connection string: server is required. Got: ${JSON.stringify({...config, password: '***'})}`);
    }

    return config as mssql.config;
  }

  async connect(): Promise<void> {
    if (!this.pool.connected) {
      await this.pool.connect();
      console.info('[database] connected to Azure SQL');
    }
  }

  async query<T>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    await this.connect();
    
    let convertedSql = sql;
    const request = this.pool.request();

    if (params && params.length > 0) {
      // Convert $1, $2 to @p1, @p2 and register them in the request
      params.forEach((value, index) => {
        const paramName = `p${index + 1}`;
        convertedSql = convertedSql.replace(new RegExp(`\\$${index + 1}(?![0-9])`, 'g'), `@${paramName}`);
        request.input(paramName, value);
      });
    }

    // Basic transformations for common PG to SQL Server differences
    // This is a minimal set; more complex migrations are handled in the service layers
    convertedSql = convertedSql
      .replace(/CREATE TABLE IF NOT EXISTS (\w+) \(/g, (match, tableName) => {
        return `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[${tableName}]') AND type in (N'U')) CREATE TABLE ${tableName} (`;
      })
      .replace(/INSERT INTO (\w+) (.+) ON CONFLICT \((.+)\) DO UPDATE SET (.+)/g, (match: string, table: string, cols: string, conflictCol: string, updateSet: string) => {
        // Simple UPSERT transformation for PG 'ON CONFLICT'
        // This is a very basic regex and might need refinement for complex cases
        // For our specific use cases in player_cache, it's usually enough
        return `
          MERGE ${table} AS target
          USING (SELECT ${cols.replace(/\((.+)\) VALUES \((.+)\)/, (m: string, c: string, v: string) => {
            const cArray = c.split(',').map((s: string) => s.trim());
            const vArray = v.split(',').map((s: string) => s.trim());
            return cArray.map((col: string, i: number) => `${vArray[i]} AS ${col}`).join(', ');
          })}) AS source
          ON (target.${conflictCol} = source.${conflictCol})
          WHEN MATCHED THEN
            UPDATE SET ${updateSet.replace(/EXCLUDED\./g, 'source.')}
          WHEN NOT MATCHED THEN
            INSERT (${cols.replace(/\((.+)\) VALUES \((.+)\)/, '$1')})
            VALUES (${cols.replace(/\((.+)\) VALUES \((.+)\)/, '$2').replace(/@p(\d+)/g, 'source.@p$1')});
        `;
      });

    try {
      const result = await request.query(convertedSql);
      return {
        rows: result.recordset as T[],
        rowCount: result.rowsAffected[0] || 0,
      };
    } catch (error) {
      console.error('[database] Azure SQL query error:', error);
      console.error('SQL:', convertedSql);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.close();
    console.info('[database] Azure SQL pool closed');
  }

  getPool(): mssql.ConnectionPool {
    return this.pool;
  }
}

