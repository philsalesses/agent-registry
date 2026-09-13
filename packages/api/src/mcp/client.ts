/**
 * AnsHttp: the small typed HTTP client behind every ANS MCP tool.
 *
 * Shared source. The canonical copy lives in packages/api/src/mcp/client.ts and
 * is copied byte for byte into packages/mcp/src/shared/client.ts by
 * `pnpm --filter ans-mcp sync` (a test fails when the copies drift). Keep it
 * free of Node-only APIs (no Buffer, no fs): it runs inside the API process and
 * inside the published `ans-mcp` stdio package on Node 20+.
 *
 * Auth, in order of preference:
 *   identity -> signed request (X-Agent-Id, X-Agent-Timestamp, X-Agent-Nonce,
 *               X-Agent-Signature over `${METHOD}:${pathname}:${timestamp}:${rawBody}`)
 *   apiKey   -> Authorization: Bearer ak_...
 *   neither  -> anonymous (public routes only)
 */
import { signRequest } from 'ans-core';

export const DEFAULT_API_URL = 'https://api.ans-registry.org';
export const DEFAULT_WEB_URL = 'https://ans-registry.org';

export interface AnsIdentity {
  agentId: string;
  /** base64 Ed25519 private key; never sent anywhere */
  privateKey: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type AuthMode = 'signed' | 'apikey' | 'none';

export interface AnsHttpOptions {
  baseUrl?: string;
  identity?: AnsIdentity | null;
  apiKey?: string | null;
  /** Override transport, e.g. an in-process `app.request` inside the API */
  fetch?: FetchLike;
  /** Extra headers on every request (User-Agent, X-Forwarded-For, X-Request-Id) */
  headers?: Record<string, string>;
  /** Default per-request timeout; 60 s */
  timeoutMs?: number;
}

export interface AnsRequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  /** 'auto' (default) signs or bears when credentials exist; 'none' sends no credentials */
  auth?: 'auto' | 'none';
  idempotencyKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** The teaching envelope `{error, message, fix?, details?, requestId}` as a throwable. */
export class AnsApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fix?: Record<string, unknown>;
  readonly details?: unknown;
  readonly requestId?: string;
  /** The parsed error body (extra top-level fields such as `required`, `have`, `closest`) */
  readonly body?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    init: { status?: number; fix?: Record<string, unknown>; details?: unknown; requestId?: string; body?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AnsApiError';
    this.code = code;
    this.status = init.status ?? 0;
    this.fix = init.fix;
    this.details = init.details;
    this.requestId = init.requestId;
    this.body = init.body;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = { error: this.code, status: this.status, message: this.message };
    if (this.fix) out.fix = this.fix;
    if (this.details !== undefined) out.details = this.details;
    if (this.body) {
      for (const [k, v] of Object.entries(this.body)) {
        if (!(k in out) && k !== '_ans' && k !== 'requestId') out[k] = v;
      }
    }
    if (this.requestId) out.requestId = this.requestId;
    return out;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The pathname the API sees in `c.req.path`: Hono decodes a path that contains
 * a percent escape with decodeURI (guarding literal %25). Signing must use the
 * same string or the signature will not verify.
 */
export function serverPathname(pathname: string): string {
  if (!pathname.includes('%')) return pathname;
  const guarded = pathname.includes('%25') ? pathname.replace(/%25/g, '%2525') : pathname;
  try {
    return decodeURI(guarded);
  } catch {
    return pathname;
  }
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class AnsHttp {
  readonly baseUrl: string;
  private identity: AnsIdentity | null;
  private apiKey: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(opts: AnsHttpOptions = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_API_URL).replace(/\/+$/, '');
    this.identity = opts.identity ?? null;
    this.apiKey = opts.apiKey ?? null;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.extraHeaders = { ...(opts.headers ?? {}) };
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  /** How requests authenticate right now */
  get authMode(): AuthMode {
    if (this.identity) return 'signed';
    if (this.apiKey) return 'apikey';
    return 'none';
  }

  /** The agent id when this client signs as an identity */
  get identityAgentId(): string | null {
    return this.identity?.agentId ?? null;
  }

  get hasApiKey(): boolean {
    return !!this.apiKey;
  }

  setIdentity(identity: AnsIdentity | null): void {
    this.identity = identity;
  }

  setApiKey(apiKey: string | null): void {
    this.apiKey = apiKey;
  }

  /** Absolute URL for an API path with an optional query */
  url(path: string, query?: AnsRequestOptions['query']): string {
    const u = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  get<T = unknown>(path: string, opts: AnsRequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, undefined, opts);
  }

  post<T = unknown>(path: string, body?: unknown, opts: AnsRequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, body, opts);
  }

  patch<T = unknown>(path: string, body?: unknown, opts: AnsRequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, body, opts);
  }

  delete<T = unknown>(path: string, opts: AnsRequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, undefined, opts);
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, opts: AnsRequestOptions = {}): Promise<T> {
    const upper = method.toUpperCase();
    const href = this.url(path, opts.query);
    const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const headers: Record<string, string> = { Accept: 'application/json', ...this.extraHeaders, ...(opts.headers ?? {}) };
    if (raw) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    if (opts.auth !== 'none') {
      if (this.identity) {
        const signed = await signRequest(this.identity.privateKey, {
          method: upper,
          pathname: serverPathname(new URL(href).pathname),
          body: raw,
          agentId: this.identity.agentId,
        });
        Object.assign(headers, signed);
      } else if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }
    }

    let res: Response;
    try {
      res = await this.fetchImpl(href, {
        method: upper,
        headers,
        body: raw ? raw : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
      });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      throw new AnsApiError(
        timedOut ? 'timeout' : 'network_error',
        timedOut ? `${upper} ${path} timed out` : `${upper} ${path} failed: ${e?.message ?? String(err)}`,
        { status: 0, details: { url: href } },
      );
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!res.ok) {
      if (isRecord(parsed) && typeof parsed.error === 'string') {
        throw new AnsApiError(parsed.error, typeof parsed.message === 'string' ? parsed.message : `${upper} ${path} failed with ${res.status}`, {
          status: res.status,
          fix: isRecord(parsed.fix) ? parsed.fix : undefined,
          details: parsed.details,
          requestId: typeof parsed.requestId === 'string' ? parsed.requestId : res.headers.get('X-Request-Id') ?? undefined,
          body: parsed,
        });
      }
      throw new AnsApiError(`http_${res.status}`, `${upper} ${path} failed with ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, {
        status: res.status,
        requestId: res.headers.get('X-Request-Id') ?? undefined,
      });
    }

    if (parsed === undefined) return (text as unknown) as T;
    return parsed as T;
  }

  /** A fresh Idempotency-Key */
  static idempotencyKey(prefix = 'mcp'): string {
    return `${prefix}-${randomId()}`;
  }
}
