import pino from 'pino';

/** Set `LOG_PRETTY=1` with `NODE_ENV=development` for human-readable logs (see `npm run dev`). */
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

const pinoOptions = {
  level: logLevel,
  formatters: {
    level: (label: string) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

const usePrettyTransport =
  process.env.LOG_PRETTY === '1' &&
  process.env.NODE_ENV !== 'production' &&
  process.env.NODE_ENV !== 'test';

export const logger = usePrettyTransport
  ? pino(
      pinoOptions,
      pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
        },
      }),
    )
  : pino(pinoOptions);

export default logger;
