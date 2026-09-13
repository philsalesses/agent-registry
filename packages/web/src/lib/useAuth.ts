'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { signMessage, signRequest } from '@/vendor/ans-core';
import { API_URL } from './config';
import { ApiError } from './api';

/**
 * Browser session for the web app.
 *
 * Sign-in never sends a private key anywhere: the page asks the API for a
 * challenge, signs the nonce in the browser, and exchanges the signature for a
 * session token. The key itself stays in this module's memory for the life of
 * the page (so receipt actions can be signed) and is never written to storage.
 */

export interface SessionAgent {
  id: string;
  handle: string | null;
  name: string;
  avatar?: string | null;
}

export interface Session {
  token: string;
  agent: SessionAgent;
  expiresAt: number;
}

export interface Credentials {
  agentId: string;
  privateKey: string;
  publicKey?: string;
  handle?: string;
  apiKey?: string;
}

const STORAGE_KEY = 'ans_session_v2';

type State = { session: Session | null; ready: boolean; heldKeyFor: string | null };

let state: State = { session: null, ready: false, heldKeyFor: null };
let heldKey: Credentials | null = null;
const listeners = new Set<() => void>();

function emit(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function readStored(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token || !parsed.agent?.id || parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(session: Session | null) {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: the session lives for this page only
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!state.ready && typeof window !== 'undefined') {
    emit({ session: readStored(), ready: true });
  }
  return () => listeners.delete(listener);
}

const serverState: State = { session: null, ready: false, heldKeyFor: null };

/** Parse a credentials file or pasted JSON. Accepts the ans-mcp and web registration formats. */
export function parseCredentials(text: string): Credentials {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That is not a JSON credentials file');
  }
  const creds = (data.credentials as Record<string, unknown> | undefined) ?? data;
  const agentId = creds.agentId ?? creds.id;
  const privateKey = creds.privateKey;
  if (typeof agentId !== 'string' || typeof privateKey !== 'string') {
    throw new Error('The credentials need agentId and privateKey');
  }
  return {
    agentId,
    privateKey,
    publicKey: typeof creds.publicKey === 'string' ? creds.publicKey : undefined,
    handle: typeof creds.handle === 'string' ? creds.handle : undefined,
    apiKey: typeof creds.apiKey === 'string' ? creds.apiKey : undefined,
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

export type SignInStep =
  | { kind: 'challenge'; nonce: string }
  | { kind: 'signed'; signature: string }
  | { kind: 'session'; expiresAt: number };

export async function signIn(creds: Credentials, onStep?: (step: SignInStep) => void): Promise<Session> {
  const challenge = await postJson<{ id: string; nonce: string }>('/v1/auth/challenge', {});
  onStep?.({ kind: 'challenge', nonce: challenge.nonce });
  const signature = await signMessage(creds.privateKey, challenge.nonce);
  onStep?.({ kind: 'signed', signature });
  const result = await postJson<{ token: string; expiresIn: number; agent: SessionAgent }>('/v1/auth/verify', {
    challengeId: challenge.id,
    agentId: creds.agentId,
    signature,
  });
  const session: Session = {
    token: result.token,
    agent: { id: result.agent.id, handle: result.agent.handle ?? creds.handle ?? null, name: result.agent.name, avatar: result.agent.avatar ?? null },
    expiresAt: Date.now() + (result.expiresIn || 24 * 3600 * 1000),
  };
  heldKey = creds;
  writeStored(session);
  emit({ session, ready: true, heldKeyFor: creds.agentId });
  onStep?.({ kind: 'session', expiresAt: session.expiresAt });
  return session;
}

export function signOut() {
  heldKey = null;
  writeStored(null);
  emit({ session: null, heldKeyFor: null });
}

/** Keep a key in memory without changing the session (e.g. after registering) */
export function holdKey(creds: Credentials) {
  heldKey = creds;
  emit({ heldKeyFor: creds.agentId });
}

export function forgetKey() {
  heldKey = null;
  emit({ heldKeyFor: null });
}

export function getHeldKey(): Credentials | null {
  return heldKey;
}

/** Sign a canonical string with the held key */
export async function signWithHeldKey(canonical: string): Promise<string> {
  if (!heldKey) throw new Error('Load your credentials file to sign this action');
  return signMessage(heldKey.privateKey, canonical);
}

/** A request signed with the held key: X-Agent-Id, timestamp, nonce, signature */
export async function signedFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!heldKey) throw new Error('Load your credentials file to sign this action');
  const raw = body === undefined ? '' : JSON.stringify(body);
  const pathname = path.split('?')[0];
  const headers = await signRequest(heldKey.privateKey, { method, pathname, body: raw, agentId: heldKey.agentId });
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { ...headers, Accept: 'application/json', ...(raw ? { 'Content-Type': 'application/json' } : {}) } as Record<string, string>,
    body: raw || undefined,
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

/** A request authenticated with the session token */
export async function sessionFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = state.session?.token;
  if (!token) throw new ApiError(401, { error: 'unauthorized', message: 'Sign in first' });
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (res.status === 401) signOut();
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

export function useAuth() {
  const snap = useSyncExternalStore(subscribe, () => state, () => serverState);
  const hasKey = !!snap.heldKeyFor && !!snap.session && snap.heldKeyFor === snap.session.agent.id;
  return {
    session: snap.session,
    ready: snap.ready,
    isAuthenticated: !!snap.session,
    hasKey,
    heldKeyFor: snap.heldKeyFor,
    signIn: useCallback((c: Credentials, onStep?: (step: SignInStep) => void) => signIn(c, onStep), []),
    signOut: useCallback(() => signOut(), []),
  };
}
