import { eq } from 'drizzle-orm';
import { generateKeypair, toBase64, toBase64Url, randomBytes } from 'ans-core';
import { db } from '../db';
import { registrySecrets } from '../db/schema';
import { config } from '../config';

/**
 * When the environment does not provide SESSION_SECRET or the registry keypair,
 * generate them once and keep them in registry_secrets so every instance and every
 * restart agrees. Environment variables always win. Never exposed by any route.
 */

async function getOrCreate(key: string, create: () => Promise<string>): Promise<string> {
  const existing = await db.select().from(registrySecrets).where(eq(registrySecrets.key, key));
  if (existing[0]) return existing[0].value;
  const value = await create();
  await db.insert(registrySecrets).values({ key, value }).onConflictDoNothing();
  const stored = await db.select().from(registrySecrets).where(eq(registrySecrets.key, key));
  return stored[0].value;
}

export async function ensureSecrets(): Promise<{ sessionSecret: 'env' | 'database'; registryKeys: 'env' | 'database' }> {
  let sessionSource: 'env' | 'database' = 'env';
  let keysSource: 'env' | 'database' = 'env';

  if (!config.sessionSecretFromEnv) {
    config.sessionSecret = await getOrCreate('session_secret', async () => toBase64Url(randomBytes(48)));
    sessionSource = 'database';
  }

  if (!config.registryPrivateKey || !config.registryPublicKey) {
    const raw = await getOrCreate('registry_keypair', async () => {
      const pair = await generateKeypair();
      return JSON.stringify({ privateKey: toBase64(pair.privateKey), publicKey: toBase64(pair.publicKey) });
    });
    const parsed = JSON.parse(raw) as { privateKey: string; publicKey: string };
    config.registryPrivateKey = parsed.privateKey;
    config.registryPublicKey = parsed.publicKey;
    keysSource = 'database';
  }

  return { sessionSecret: sessionSource, registryKeys: keysSource };
}
