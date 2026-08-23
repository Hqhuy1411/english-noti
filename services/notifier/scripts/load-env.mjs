/**
 * Load the repo-root .env for local scripts, so they run as a bare
 * `node script.mjs` with no --env-file flag to remember.
 *
 * Uses process.loadEnvFile (Node 21.7+) -- no dotenv dependency.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export function loadEnv() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const envPath = resolve(repoRoot, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}
