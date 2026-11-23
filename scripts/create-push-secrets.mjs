// Creates secret files without printing their contents. Run outside the repo,
// then import each file using `wrangler secret put NAME < /path/NAME`.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const target = process.argv[2] && resolve(process.argv[2]);
if (!target || target === resolve('.') || target.startsWith(resolve('.') + sep)) throw new Error('Provide an output directory outside the repository');
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
await mkdir(target, { mode: 0o700 });
await writeFile(resolve(target, 'WEB_PUSH_PRIVATE_KEY'), JSON.stringify({ publicKey, privateKey: jwk.d }), { mode: 0o600, flag: 'wx' });
await writeFile(resolve(target, 'PUSH_STORAGE_SECRET'), randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
console.log('Created WEB_PUSH_PRIVATE_KEY and PUSH_STORAGE_SECRET files. Keep them private; import with Wrangler after CI passes.');
