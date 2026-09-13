/**
 * The credentials file: $ANS_CREDENTIALS or ~/.config/ans/credentials.json,
 * mode 600 in a 700 directory, written atomically. It holds the agent's
 * private key, which never leaves this file (every request and receipt
 * canonical is signed locally), plus the registration API key, the API base
 * and the local daily cash cap with today's counter.
 */
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fromBase64, parseUsdToMicros } from 'ans-core';
import type { SpendLedger } from './shared/tools';

export interface AnsCredentials {
  agentId: string;
  handle: string;
  name?: string;
  publicKey: string;
  /** base64 Ed25519 private key */
  privateKey: string;
  /** registration API key (ak_...), for remote MCP clients */
  apiKey: string;
  /** API base the agent is registered on */
  api: string;
  registeredAt: string;
  /** Local cap on cash spend per UTC day, in US dollars. 0 means no cash spend. Only your operator raises it. */
  spendCapUsdPerDay: number;
  /** Refuse invokes and client receipts with unregistered counterparties (default true) */
  requireRegistered?: boolean;
  /** Today's cash counter for the local cap */
  spend?: { day: string; cashMicros: string };
}

export type CredentialsRead =
  | { status: 'missing'; path: string }
  | { status: 'ok'; path: string; creds: AnsCredentials }
  | { status: 'invalid'; path: string; error: string };

export function defaultCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ANS_CREDENTIALS && env.ANS_CREDENTIALS.trim()) return resolve(env.ANS_CREDENTIALS.trim());
  return join(homedir(), '.config', 'ans', 'credentials.json');
}

function isKey(b64: unknown, bytes: number): boolean {
  if (typeof b64 !== 'string') return false;
  try {
    return fromBase64(b64).length === bytes;
  } catch {
    return false;
  }
}

export function validateCredentials(raw: unknown): { ok: true; creds: AnsCredentials } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'not a JSON object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.agentId !== 'string' || !/^ag_[A-Za-z0-9]{8,64}$/.test(r.agentId)) return { ok: false, error: 'agentId is missing or malformed' };
  if (!isKey(r.privateKey, 32)) return { ok: false, error: 'privateKey must be a base64 Ed25519 private key (32 bytes)' };
  if (!isKey(r.publicKey, 32)) return { ok: false, error: 'publicKey must be a base64 Ed25519 public key (32 bytes)' };
  const cap = r.spendCapUsdPerDay === undefined ? 0 : r.spendCapUsdPerDay;
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) return { ok: false, error: 'spendCapUsdPerDay must be a non-negative number' };
  return {
    ok: true,
    creds: {
      agentId: r.agentId,
      handle: typeof r.handle === 'string' ? r.handle : '',
      name: typeof r.name === 'string' ? r.name : undefined,
      publicKey: r.publicKey as string,
      privateKey: r.privateKey as string,
      apiKey: typeof r.apiKey === 'string' ? r.apiKey : '',
      api: typeof r.api === 'string' ? r.api : '',
      registeredAt: typeof r.registeredAt === 'string' ? r.registeredAt : '',
      spendCapUsdPerDay: cap,
      requireRegistered: typeof r.requireRegistered === 'boolean' ? r.requireRegistered : undefined,
      spend:
        typeof r.spend === 'object' && r.spend !== null && typeof (r.spend as { day?: unknown }).day === 'string' && /^\d+$/.test(String((r.spend as { cashMicros?: unknown }).cashMicros))
          ? { day: (r.spend as { day: string }).day, cashMicros: String((r.spend as { cashMicros: unknown }).cashMicros) }
          : undefined,
    },
  };
}

export async function readCredentials(path: string): Promise<CredentialsRead> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', path };
    return { status: 'invalid', path, error: (err as Error).message };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 'invalid', path, error: 'not valid JSON' };
  }
  const v = validateCredentials(parsed);
  return v.ok ? { status: 'ok', path, creds: v.creds } : { status: 'invalid', path, error: v.error };
}

/** Write atomically with mode 600 (directory 700). Existing directories keep their mode. */
export async function writeCredentials(path: string, creds: AnsCredentials): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
}

/** Copy an existing credentials file aside (mode 600) before it is replaced; returns the backup path. */
export async function backupCredentials(path: string): Promise<string | null> {
  try {
    await stat(path);
  } catch {
    return null;
  }
  const backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copyFile(path, backup);
  await chmod(backup, 0o600);
  return backup;
}

export function capMicrosOf(creds: Pick<AnsCredentials, 'spendCapUsdPerDay'> | null): bigint {
  if (!creds) return 0n;
  try {
    return parseUsdToMicros(creds.spendCapUsdPerDay.toFixed(6));
  } catch {
    return 0n;
  }
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The daily cash counter kept inside the credentials file. */
export function fileSpendLedger(path: string): SpendLedger {
  return {
    async spentToday(now) {
      const r = await readCredentials(path);
      if (r.status !== 'ok' || !r.creds.spend || r.creds.spend.day !== utcDay(now)) return 0n;
      return BigInt(r.creds.spend.cashMicros);
    },
    async record(micros, now) {
      const r = await readCredentials(path);
      if (r.status !== 'ok') return;
      const day = utcDay(now);
      const sameDay = !!r.creds.spend && r.creds.spend.day === day;
      // a release (negative) for a day that already rolled over has nothing left to give back
      if (micros < 0n && !sameDay) return;
      const prior = sameDay ? BigInt(r.creds.spend!.cashMicros) : 0n;
      const next = prior + micros < 0n ? 0n : prior + micros;
      // keep every field the operator put in the file, only the counter changes
      const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      raw.spend = { day, cashMicros: next.toString() };
      await writeCredentials(path, raw as unknown as AnsCredentials);
    },
  };
}
