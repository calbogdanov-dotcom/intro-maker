import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { createApp } from './app.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
try {
  const dotenv = resolve(root, '.env');
  if (existsSync(dotenv)) process.loadEnvFile(dotenv);
  const { default: worker } = await import(pathToFileURL(resolve(root, 'dist/server/index.js')));
  const origin = process.env.INTRO_MAKER_ORIGIN || 'http://localhost:8787';
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1';
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createApp({ worker, dataDir: resolve(root, process.env.INTRO_MAKER_DATA_DIR || 'data'), password: process.env.INTRO_MAKER_PASSWORD, username: process.env.INTRO_MAKER_USERNAME || 'owner', origin });
  server.on('error', error => { console.error('Server could not start:', error.code || error.name); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Intro Maker is listening on ${host}:${port}. Open ${new URL(origin).origin}/maker/`));
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
} catch (error) { console.error(error.message); process.exitCode = 1; }
