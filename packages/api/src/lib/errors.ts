import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import {
  ANS_BLOCK,
  AnsError,
  HELP_LINK_HEADER,
  REGISTER_FIX,
  teachingError,
  type ErrorCode,
  type TeachingError,
  type TeachingFix,
} from 'ans-core';

/**
 * Teaching error envelope (docs/DESIGN.md section 4): every 4xx/5xx from the
 * API is `{error, message, fix?, requestId, details?}` plus a
 * `Link: <skill.md>; rel="help"` header.
 */

/** Codes the API can teach: the ans-core set plus the stub marker. */
export type TeachCode = ErrorCode | 'not_implemented';

export interface TeachExtra {
  fix?: TeachingFix;
  details?: unknown;
  /** Extra top-level fields (e.g. retryAfter on 429) */
  extra?: Record<string, unknown>;
}

export function getRequestId(c: Context): string {
  const id = c.get('requestId') as string | undefined;
  return id && id.length > 0 ? id : 'unknown';
}

/**
 * Respond with the teaching envelope.
 */
export function teach(c: Context, status: number, code: TeachCode, message: string, extra: TeachExtra = {}): Response {
  const envelope: TeachingError & Record<string, unknown> = {
    ...teachingError(code as ErrorCode, message, getRequestId(c), { fix: extra.fix, details: extra.details }),
    ...(extra.extra ?? {}),
  };
  c.header('Link', HELP_LINK_HEADER);
  c.header('X-Request-Id', getRequestId(c));
  return c.json(envelope, status as ContentfulStatusCode);
}

/** Add the `_ans` block every public JSON response carries. */
export function withAns<T extends object>(body: T): T & { _ans: typeof ANS_BLOCK } {
  return { ...body, _ans: ANS_BLOCK };
}

/** `c.json(withAns(body), status)` */
export function jsonAns<T extends object>(c: Context, body: T, status: number = 200): Response {
  return c.json(withAns(body), status as ContentfulStatusCode);
}

/** The standard "register first" fix block. */
export const registerFix: TeachingFix = REGISTER_FIX;

function isPgError(err: unknown): err is { code: string; message: string; detail?: string; constraint_name?: string } {
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string'
    && /^[0-9A-Z]{5}$/.test((err as { code: string }).code);
}

/**
 * Hono onError: zod -> 400 validation_error, AnsError -> its envelope,
 * HTTPException -> its status, everything else -> 500 internal (logged with requestId).
 */
export const onError: ErrorHandler = (err, c) => {
  const requestId = getRequestId(c);

  if (err instanceof ZodError) {
    return teach(c, 400, 'validation_error', 'Request failed validation', {
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
      fix: { docs: ANS_BLOCK.docs },
    });
  }

  if (err instanceof AnsError) {
    return teach(c, err.status, err.code, err.message, { fix: err.fix, details: err.details });
  }

  if (err instanceof HTTPException) {
    const status = err.status;
    const code: TeachCode = status === 404 ? 'not_found'
      : status === 401 ? 'unauthorized'
      : status === 403 ? 'forbidden'
      : status === 409 ? 'conflict'
      : status === 429 ? 'rate_limited'
      : status >= 500 ? 'internal'
      : 'bad_request';
    return teach(c, status, code, err.message || 'Request failed');
  }

  // Bad JSON bodies surface as SyntaxError from c.req.json()
  if (err instanceof SyntaxError && /JSON/i.test(err.message)) {
    return teach(c, 400, 'bad_request', 'Request body is not valid JSON');
  }

  if (isPgError(err) && err.code === '23505') {
    console.error(`[${requestId}] unique violation`, err.detail ?? err.message);
    return teach(c, 409, 'conflict', 'A record with those values already exists', {
      details: err.constraint_name ? { constraint: err.constraint_name } : undefined,
    });
  }

  console.error(`[${requestId}] unhandled error:`, err);
  return teach(c, 500, 'internal', 'Internal server error');
};

export const notFound: NotFoundHandler = (c) =>
  teach(c, 404, 'not_found', `No route for ${c.req.method} ${c.req.path}`, {
    fix: { docs: ANS_BLOCK.docs, url: `${ANS_BLOCK.docs}` },
  });
