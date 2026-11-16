import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = new URL('../.env', import.meta.url);
try {
  const file = await open(target, 'wx', 0o600);
  try {
    await file.writeFile(`# Owner credentials stay on this machine. Never commit this file.\nINTRO_MAKER_USERNAME=owner\nINTRO_MAKER_PASSWORD=${randomBytes(24).toString('base64url')}\nINTRO_MAKER_ORIGIN=http://localhost:8787\nHOST=127.0.0.1\nPORT=8787\nINTRO_MAKER_DATA_DIR=data\n`);
  } finally { await file.close(); }
  console.log(`Created ${fileURLToPath(target)} with a unique owner password. Open this file to read or change it, then run npm start.`);
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env already exists; existing owner credentials were preserved.');
  else throw error;
}
