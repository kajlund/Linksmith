import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenv } from 'dotenv';

const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
export const defaultEnvFile = fileURLToPath(
  new URL('../../.env', import.meta.url),
);

// Shell/service variables take precedence; the default file location is independent
// of the working directory, including after compilation into server/dist.

export function loadEnvironment() {
  const result = dotenv({
    path: process.env.ENV_FILE ? resolve(process.env.ENV_FILE) : defaultEnvFile,
    quiet: true,
  });
  if (
    result.error &&
    (process.env.ENV_FILE ||
      (result.error as NodeJS.ErrnoException).code !== 'ENOENT')
  ) {
    throw new Error(
      'Could not read the environment file. Check ENV_FILE and its permissions.',
    );
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!env.DATABASE_URL)
    throw new Error(
      'Set DATABASE_URL in the repository .env file or process environment.',
    );
  try {
    const url = new URL(env.DATABASE_URL);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length <= 1
    )
      throw new Error();
  } catch {
    throw new Error('Invalid DATABASE_URL. Use a PostgreSQL connection URL.');
  }

  const bind = env.BIND_ADDR ?? '127.0.0.1:8080';
  const match = /^(?:\[([^\]]+)\]|([^:\s]+)):(\d+)$/.exec(bind);
  if (!match || Number(match[3]) < 1 || Number(match[3]) > 65535)
    throw new Error('BIND_ADDR must be host:port, for example 127.0.0.1:8080.');
  const pretty =
    env.LOG_PRETTY === undefined
      ? env.NODE_ENV !== 'production'
      : env.LOG_PRETTY === 'true';
  if (
    env.LOG_PRETTY !== undefined &&
    !['true', 'false'].includes(env.LOG_PRETTY)
  )
    throw new Error('LOG_PRETTY must be true or false.');

  return {
    databaseURL: env.DATABASE_URL,
    hostname: match[1] ?? match[2],
    port: Number(match[3]),
    clientDirectory: resolve(
      serverDirectory,
      env.CLIENT_DIR || '../client/dist',
    ),
    logLevel: env.LOG_LEVEL ?? 'info',
    pretty,
  };
}
