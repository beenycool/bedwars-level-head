import { Kysely, PostgresDialect, MssqlDialect } from 'kysely';
import { Pool } from 'pg';
import * as mssql from 'mssql';
import { Database } from './schema';
import { logger } from '../../util/logger';

export enum DatabaseType {
  POSTGRESQL = 'POSTGRESQL',
  AZURE_SQL = 'AZURE_SQL',
}

// Ensure connection string can be found, otherwise fallback so parse logic works
const connectionString = process.env.CACHE_DB_URL || process.env.DATABASE_URL || 'postgres://localhost';

export function getDatabaseType(connString: string): DatabaseType {
  const normalized = connString.trim();
  if (normalized.startsWith('postgresql://') || normalized.startsWith('postgres://')) {
    return DatabaseType.POSTGRESQL;
  }
  if (normalized.startsWith('sqlserver://') || normalized.startsWith('mssql://')) {
    return DatabaseType.AZURE_SQL;
  }
  if (/^(server|data source)\s*=/i.test(normalized) || /;\s*(initial catalog|user id)\s*=/i.test(normalized)) {
    return DatabaseType.AZURE_SQL;
  }
  return DatabaseType.POSTGRESQL;
}

export const dbType = getDatabaseType(connectionString);

/**
 * Parses connection strings for Azure SQL/MSSQL (ODBC-style or URL format).
 */
export function parseMssqlConfig(connString: string): mssql.config {
  if (connString.startsWith('mssql://') || connString.startsWith('sqlserver://')) {
    const normalizedString = connString.replace(/^sqlserver:/i, 'mssql:');
    try {
      const url = new URL(normalizedString);
      const parsedConfig: any = {
        server: url.hostname,
        user: url.username,
        password: url.password,
        options: {
          encrypt: true,
          trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
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

      if (parsedConfig.server) {
        if (parsedConfig.server.includes('.database.windows.net') && parsedConfig.user && !parsedConfig.user.includes('@')) {
          parsedConfig.user = `${parsedConfig.user}@${parsedConfig.server.split('.')[0]}`;
        }
        return parsedConfig as mssql.config;
      }
    } catch (error) {}
  }

  const config: any = {
      server: '',
      user: '',
      password: '',
      database: '',
      options: {
          encrypt: true,
          trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
      }
  };

  const withoutPrefix = connString.replace(/^mssql:\/\//i, '').replace(/^sqlserver:\/\//i, '');

  const processPair = (key: string, value: string) => {
      const lowerKey = key.trim().toLowerCase();
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
      }
  };

  const rawParts = withoutPrefix.split(';');
  let currentKey = '';
  let currentValue = '';

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
  if (currentKey) {
      processPair(currentKey, currentValue);
  }

  if (config.server.toLowerCase().startsWith('tcp:')) {
      config.server = config.server.substring(4);
  }

  if (config.server.includes('.database.windows.net') && config.user && !config.user.includes('@')) {
    config.user = `${config.user}@${config.server.split('.')[0]}`;
  }

  return config as mssql.config;
}


const rawPoolMax = process.env.DB_POOL_MAX || process.env.CACHE_DB_POOL_MAX;
const dbPoolMax = rawPoolMax ? parseInt(rawPoolMax, 10) : (dbType === DatabaseType.POSTGRESQL ? 20 : 10);
const validatedPoolMax = Number.isFinite(dbPoolMax) && dbPoolMax > 0 ? dbPoolMax : 10;

let db: Kysely<Database>;

if (dbType === DatabaseType.POSTGRESQL) {
  const pool = new Pool({
    connectionString,
    max: validatedPoolMax,
    idleTimeoutMillis: 30000,
  });

  db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool,
    }),
    log: (event) => {
      if (event.level === 'error') {
        logger.error({ err: event.error, sql: event.query.sql, params: event.query.parameters }, '[db] Query Error');
      }
    },
  });

  logger.info(`[db] Kysely initialized with PostgreSQL (pool max: ${validatedPoolMax})`);

} else {
  const config = parseMssqlConfig(connectionString);
  const pool = new mssql.ConnectionPool(config);

  db = new Kysely<Database>({
    dialect: new MssqlDialect({
      tarn: {
        options: {
          min: 0,
          max: validatedPoolMax,
        },
      },
      pool: async () => pool,
    }),
    log: (event) => {
      if (event.level === 'error') {
        logger.error({ err: event.error, sql: event.query.sql, params: event.query.parameters }, '[db] Query Error');
      }
    },
  });

  logger.info(`[db] Kysely initialized with Azure SQL (pool max: ${validatedPoolMax})`);
}

export { db };
