import pino from 'pino';

export function createLogger(level = 'info', pretty = false) {
  return pino({
    level,
    redact: [
      'databaseURL',
      'DATABASE_URL',
      'password',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: process.stdout.isTTY,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}
