import type { ErrorCode, TeachingFix } from 'ans-core';

/**
 * Codes an AnsApiError can carry: every registry teaching code, plus
 * `network_error` (the registry could not be reached) and `http_error`
 * (a non-JSON error response, for example from a proxy in front of the API).
 */
export type AnsErrorCode = ErrorCode | 'network_error' | 'http_error' | (string & {});

export interface AnsApiErrorInit {
  status: number;
  code: AnsErrorCode;
  message: string;
  fix?: TeachingFix | null;
  details?: unknown;
  requestId?: string | null;
  body?: unknown;
  cause?: unknown;
}

/**
 * Thrown by every ANSClient call that fails. Fields come from the registry's
 * teaching envelope `{error, message, fix?, details?, requestId}`.
 *
 * `status` is 0 and `requestId` is null when the error was raised before any
 * response arrived (network failure or a local precondition such as a call
 * that needs your agent id before `register()`).
 */
export class AnsApiError extends Error {
  readonly status: number;
  readonly code: AnsErrorCode;
  readonly fix: TeachingFix | null;
  readonly details: unknown;
  readonly requestId: string | null;
  /** The parsed response body, when there was one */
  readonly body: unknown;

  constructor(init: AnsApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'AnsApiError';
    this.status = init.status;
    this.code = init.code;
    this.fix = init.fix ?? null;
    this.details = init.details;
    this.requestId = init.requestId ?? null;
    this.body = init.body;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Build an error from a non-2xx response and its parsed body (JSON value or text). */
  static fromResponse(res: Response, body: unknown): AnsApiError {
    const headerRequestId = res.headers.get('x-request-id');
    if (isEnvelope(body)) {
      return new AnsApiError({
        status: res.status,
        code: body.error,
        message: typeof body.message === 'string' && body.message ? body.message : `${res.status} ${body.error}`,
        fix: isObject(body.fix) ? (body.fix as unknown as TeachingFix) : null,
        details: body.details,
        requestId: typeof body.requestId === 'string' ? body.requestId : headerRequestId,
        body,
      });
    }
    const snippet = typeof body === 'string' ? body.slice(0, 200) : '';
    return new AnsApiError({
      status: res.status,
      code: 'http_error',
      message: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${snippet ? `: ${snippet}` : ''}`,
      requestId: headerRequestId,
      body,
    });
  }
}

/** True for errors thrown by this SDK's client calls */
export function isAnsApiError(err: unknown): err is AnsApiError {
  return err instanceof AnsApiError;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEnvelope(v: unknown): v is { error: string; message?: unknown; fix?: unknown; details?: unknown; requestId?: unknown } {
  return isObject(v) && typeof v.error === 'string' && v.error.length > 0;
}
