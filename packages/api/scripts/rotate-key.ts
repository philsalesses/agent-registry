#!/usr/bin/env tsx
/**
 * Rotate an agent's key (docs/DESIGN.md section 10 and 14.19).
 *
 *   pnpm --filter @agent-registry/api rotate-key -- <old-credentials.json> [--api https://api.ans-registry.org] [--out <new-credentials.json>]
 *
 * Reads the OLD credentials file ({agentId, publicKey, privateKey}), confirms
 * the live public key still matches (if it does not, the account was already
 * taken and must be recovered by hand), generates a new Ed25519 keypair,
 * calls POST /v1/agents/:id/transfer signed with the old key (ans-core
 * signRequest), writes the new credentials file with mode 600 and prints the
 * next steps. Nothing is committed and nothing is pushed.
 */
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { generateKeypair, toBase64, signRequest } from 'ans-core';

interface Credentials {
  agentId: string;
  publicKey: string;
  privateKey: string;
  handle?: string;
  apiKey?: string;
  [key: string]: unknown;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`rotate-key: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
  const credPath = positional[0];
  if (!credPath) fail('usage: rotate-key <old-credentials.json> [--api <url>] [--out <file>]');

  const api = (arg('--api') ?? process.env.ANS_API_URL ?? 'https://api.ans-registry.org').replace(/\/+$/, '');
  const absolute = resolve(credPath);
  if (!existsSync(absolute)) fail(`no such file: ${absolute}`);

  const old = JSON.parse(readFileSync(absolute, 'utf8')) as Credentials;
  if (!old.agentId || !old.publicKey || !old.privateKey) fail('credentials file needs agentId, publicKey and privateKey');

  // 1. Confirm the live key still matches the old credentials.
  const profileRes = await fetch(`${api}/v1/agents/${encodeURIComponent(old.agentId)}`);
  if (profileRes.status === 404) fail(`agent ${old.agentId} is not registered at ${api}`);
  if (!profileRes.ok) fail(`GET /v1/agents/${old.agentId} answered ${profileRes.status}: ${await profileRes.text()}`);
  const profile = (await profileRes.json()) as { agent?: { publicKey?: string; handle?: string | null } };
  const livePublicKey = profile.agent?.publicKey;
  if (!livePublicKey) fail('profile response carries no agent.publicKey');
  if (livePublicKey !== old.publicKey) {
    fail(`live public key (${livePublicKey}) does not match the credentials file (${old.publicKey}). The account was already transferred; recover it by hand before purging history.`);
  }
  console.log(`Live key matches ${old.agentId}${profile.agent?.handle ? ` (@${profile.agent.handle})` : ''}. Rotating.`);

  // 2. New keypair.
  const pair = await generateKeypair();
  const newPublicKey = toBase64(pair.publicKey);
  const newPrivateKey = toBase64(pair.privateKey);

  // 3. POST /v1/agents/:id/transfer signed with the OLD key.
  const pathname = `/v1/agents/${old.agentId}/transfer`;
  const body = JSON.stringify({ newPublicKey });
  const headers = await signRequest(old.privateKey, { method: 'POST', pathname, body, agentId: old.agentId });
  const res = await fetch(`${api}${pathname}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body });
  const text = await res.text();
  if (!res.ok) fail(`transfer answered ${res.status}: ${text}`);

  // 4. Write the new credentials next to the old file, mode 600.
  const out = resolve(arg('--out') ?? `${dirname(absolute)}/${basename(absolute).replace(/\.json$/, '')}.rotated.json`);
  const next: Credentials = { ...old, publicKey: newPublicKey, privateKey: newPrivateKey, rotatedAt: new Date().toISOString(), previousPublicKey: old.publicKey };
  writeFileSync(out, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  chmodSync(out, 0o600);

  console.log('');
  console.log(`Rotated. New credentials written to ${out} (mode 600).`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Move ${out} to your secrets store and point ans-mcp / ans-sdk at it (ANS_CREDENTIALS_PATH or ~/.ans/credentials.json).`);
  console.log(`  2. Delete the old file: rm ${absolute}`);
  console.log('  3. Purge the leaked file from git history and force push:');
  console.log('       git filter-repo --path credentials --invert-paths');
  console.log('       git push --force --all && git push --force --tags');
  console.log('  4. credentials/ is already in .gitignore; confirm with: git check-ignore credentials/anything.json');
  console.log('  5. API keys were not rotated. Revoke and re-mint if they were exposed: GET/DELETE /v1/agents/:id/keys, POST /v1/agents/:id/keys (signed with the NEW key).');
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
