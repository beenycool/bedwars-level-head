import * as mssql from 'mssql';
import { DatabaseAdapter, DatabaseType, QueryResult } from './adapter';
import { logger } from '../../util/logger';

export class AzureSqlAdapter implements DatabaseAdapter {
  readonly type = DatabaseType.AZURE_SQL;
  private pool: mssql.ConnectionPool;

  constructor(connectionString: string) {
    // Parse the connection string manually for Azure SQL
    const config = this.parseConnectionString(connectionString);
    logger.info({
      server: config.server,
      port: config.port,
      database: config.database,
      user: config.user,
      hasPassword: !!config.password,
      trustServerCertificate: config.options?.trustServerCertificate,
      serverType: typeof config.server
    }, '[database] Azure SQL config parsed:');
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
    const config: any = {
      options: {
        encrypt: true,
        trustServerCertificate: trustServerCertificateDefault
      }
    };

    const normalizeAzureUsername = (configToNormalize: mssql.config): void => {
      // Check if server ends with '.database.windows.net' to avoid substring bypass attacks
      const server = configToNormalize.server;
      if (
        server &&
        server.endsWith('.database.windows.net') &&
        configToNormalize.user &&
        !configToNormalize.user.includes('@')
      ) {
        const serverName = server.split('.')[0];
        configToNormalize.user = `${configToNormalize.user}@${serverName}`;
        logger.info(`[database] Updated Azure SQL username to ${configToNormalize.user}`);
      }
    };

    // Try parsing as URL first (for mssql://user:pass@host:port/db format)
    if (connectionString.includes('://')) {
      try {
        // Safely parse URL-format connection strings by working around special characters
        const parsed = this.parseUrlFormat(connectionString);
        if (parsed) {
          Object.assign(config, parsed);

          // If we got a server from URL, return the config
          if (config.server) {
             normalizeAzureUsername(config);
             return config as mssql.config;
          }
        }
      } catch (e) {
        // Ignore URL parse error and fall back to manual parsing
        logger.info('[database] URL parsing failed, falling back to manual parsing');
      }
    }

    // Manual parsing for ADO.NET style or simple server:port;...
    let withoutPrefix = connectionString
      .replace(/^sqlserver:\/\//i, '')
      .replace(/^mssql:\/\//i, '');

    // Helper to process key-value pairs
    const processPair = (key: string, value: string) => {
        const lowerKey = key.toLowerCase();
        let cleanValue = value.trim();
        
        // Handle quoting
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
                // Handle server,port or server:port
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
        }
    };

    const rawParts = withoutPrefix.split(';');
    let currentKey = '';
    let currentValue = '';

    for (let i = 0; i < rawParts.length; i++) {
        const part = rawParts[i];
        
        // Check if we are inside a quoted value
        let insideQuote = false;
        if (currentKey && currentValue) {
            const trimmedVal = currentValue.trim();
            // Check for unbalanced quotes
            if (trimmedVal.startsWith("'") && !trimmedVal.endsWith("'")) insideQuote = true;
            else if (trimmedVal.startsWith('"') && !trimmedVal.endsWith('"')) insideQuote = true;
            else if (trimmedVal.startsWith('{') && !trimmedVal.endsWith('}')) insideQuote = true;
            // Edge case: just the opening quote
            if (trimmedVal === "'" || trimmedVal === '"' || trimmedVal === '{') insideQuote = true;
        }

        if (insideQuote) {
            currentValue += ';' + part;
            continue;
        }

        const equalIndex = part.indexOf('=');
        if (equalIndex > 0) {
             if (currentKey) {
                 processPair(currentKey, currentValue);
             }
             currentKey = part.substring(0, equalIndex).trim();
             currentValue = part.substring(equalIndex + 1);
        } else {
            if (currentKey) {
                currentValue += ';' + part;
            } else {
                // Handle the "ServerName" at start case (no key)
                if (i === 0 && !config.server) {
                     const firstPart = part.trim();
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
            }
        }
    }
    // Process the last pair
    if (currentKey) {
        processPair(currentKey, currentValue);
    }

    // Validate required fields
    if (!config.server || typeof config.server !== 'string') {
      throw new Error(`Invalid connection string: server is required. Got: ${JSON.stringify({...config, password: '***'})}`);
    }

    // Clean up server address (remove tcp: prefix if present)
    if (config.server.toLowerCase().startsWith('tcp:')) {
        config.server = config.server.substring(4);
    }

    logger.info(`[database] Password provided: ${!!config.password}`);

    // Azure SQL specific fix: Ensure username is in user@server format if not already
    // This is often required for Azure SQL Database
    normalizeAzureUsername(config);

    return config as mssql.config;
  }

  /**
   * Safely parses URL-format connection strings (e.g., sqlserver://user:password@host:port/database)
   * by extracting components before URL encoding special characters.
   */
  private parseUrlFormat(connectionString: string): mssql.config | null {
    try {
      // Normalize protocol
      const normalizedString = connectionString.replace(/^sqlserver:/i, 'mssql:');
      const trustServerCertificateDefault = this.getTrustServerCertificateDefault();

      const url = new URL(normalizedString);
      if (url.protocol !== 'mssql:') {
        return null;
      }

      const parsedConfig: any = {
        server: url.hostname,
        user: url.username,
        password: url.password,
        options: {
          encrypt: true,
          trustServerCertificate: trustServerCertificateDefault
        }
      };

      if (url.port) {
        parsedConfig.port = parseInt(url.port, 10);
      }

      const database = url.pathname ? url.pathname.replace(/^\//, '') : '';
      if (database) {
        parsedConfig.database = database;
      }

      url.searchParams.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'encrypt') parsedConfig.options.encrypt = value.toLowerCase() === 'true';
        else if (lowerKey === 'trustservercertificate') parsedConfig.options.trustServerCertificate = value.toLowerCase() === 'true';
        else if (lowerKey === 'database') parsedConfig.database = value;
      });

      if (!parsedConfig.server) {
        return null;
      }

      return parsedConfig as mssql.config;
    } catch (error) {
      return null;
    }
  }

  private buildMergeStatement(
    table: string,
    insertClause: string,
    conflictColumn: string,
    updateSet: string,
  ): string {
    const insertMatch = insertClause.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (!insertMatch) {
      return '';
    }

    const columns = insertMatch[1].split(',').map((col) => col.trim());
    const values = insertMatch[2].split(',').map((value) => value.trim());
    if (columns.length === 0 || columns.length !== values.length) {
      return '';
    }

    const sourceSelect = columns
      .map((column, index) => `${values[index]} AS ${column}`)
      .join(', ');
    const insertColumns = columns.join(', ');
    const insertValues = columns.map((column) => `source.${column}`).join(', ');
    const updateSetSql = updateSet.replace(/EXCLUDED\./g, 'source.');

    return `
          MERGE ${table} AS target
          USING (SELECT ${sourceSelect}) AS source
          ON (target.${conflictColumn.trim()} = source.${conflictColumn.trim()})
          WHEN MATCHED THEN
            UPDATE SET ${updateSetSql}
          WHEN NOT MATCHED THEN
            INSERT (${insertColumns})
            VALUES (${insertValues});
        `;
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
      // Optimized parameter replacement: O(N) instead of O(N^2)
      // FIX: Use explicit capturing group (\d+) to get the index for p1
      convertedSql = convertedSql.replace(/\$(\d+)(?![0-9])/g, (match, p1) => {
        const index = parseInt(p1, 10);
        if (index >= 1 && index <= params.length) {
          return `@p${index}`;
        }
        return match;
      });

      // Register parameters in the request
      params.forEach((value, index) => {
        request.input(`p${index + 1}`, value);
      });
    }

    // Basic transformations for common PG to SQL Server differences
    convertedSql = convertedSql
      .replace(/CREATE TABLE IF NOT EXISTS (\w+) \(/g, (match, tableName) => {
        return `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[${tableName}]') AND type in (N'U')) CREATE TABLE ${tableName} (`;
      })
      // Updated regex to handle multi-line SQL statements using [\s\S]+?
      .replace(/INSERT INTO (\w+) ([\s\S]+?) ON CONFLICT \(([\s\S]+?)\) DO UPDATE\s+SET ([\s\S]+)/ig, (match: string, table: string, cols: string, conflictCol: string, updateSet: string) => {
        // Simple UPSERT transformation for PG 'ON CONFLICT'
        const sanitizedUpdateSet = updateSet.replace(/;+\s*$/, '').trim();
        const mergeSql = this.buildMergeStatement(table, cols, conflictCol, sanitizedUpdateSet);
        return mergeSql || match;
      });

    try {
      const result = await request.query(convertedSql);
      return {
        rows: result.recordset as T[],
        rowCount: result.rowsAffected[0] || 0,
      };
    } catch (error) {
      logger.error({ error }, '[database] Azure SQL query error:');
      logger.error({ sql: convertedSql }, 'SQL:');
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.close();
    logger.info('[database] Azure SQL pool closed');
  }

  getPool(): mssql.ConnectionPool {
    return this.pool;
  }
}
