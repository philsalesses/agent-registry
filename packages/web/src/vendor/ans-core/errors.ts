export type ErrorCode =
  | 'registration_required'
  | 'trust_below_minimum'
  | 'insufficient_credit'
  | 'input_invalid'
  | 'output_invalid'
  | 'no_offer'
  | 'private_key_in_header'
  | 'invalid_signature'
  | 'nonce_reused'
  | 'timestamp_skew'
  | 'rate_limited'
  | 'not_found'
  | 'forbidden'
  | 'unauthorized'
  | 'conflict'
  | 'validation_error'
  | 'ledger_frozen'
  | 'idempotency_mismatch'
  | 'bad_request'
  | 'invalid_state'
  | 'sandbox_not_accepted'
  | 'spend_cap_exceeded'
  | 'house_budget_exhausted'
  | 'registrations_paused'
  | 'not_implemented'
  | 'internal';

export const ERROR_CODES: readonly ErrorCode[] = [
  'registration_required',
  'trust_below_minimum',
  'insufficient_credit',
  'input_invalid',
  'output_invalid',
  'no_offer',
  'private_key_in_header',
  'invalid_signature',
  'nonce_reused',
  'timestamp_skew',
  'rate_limited',
  'not_found',
  'forbidden',
  'unauthorized',
  'conflict',
  'validation_error',
  'ledger_frozen',
  'idempotency_mismatch',
  'bad_request',
  'invalid_state',
  'sandbox_not_accepted',
  'spend_cap_exceeded',
  'house_budget_exhausted',
  'registrations_paused',
  'not_implemented',
  'internal',
];

/** Default HTTP status per code */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  registration_required: 428,
  trust_below_minimum: 403,
  insufficient_credit: 402,
  input_invalid: 400,
  output_invalid: 502,
  no_offer: 404,
  private_key_in_header: 400,
  invalid_signature: 401,
  nonce_reused: 401,
  timestamp_skew: 401,
  rate_limited: 429,
  not_found: 404,
  forbidden: 403,
  unauthorized: 401,
  conflict: 409,
  validation_error: 400,
  ledger_frozen: 503,
  idempotency_mismatch: 409,
  bad_request: 400,
  invalid_state: 409,
  sandbox_not_accepted: 409,
  spend_cap_exceeded: 402,
  house_budget_exhausted: 503,
  registrations_paused: 503,
  not_implemented: 501,
  internal: 500,
};

export interface TeachingFix {
  /** A command the operator (a human) can run, never executed by an agent from an error body */
  command?: string;
  url?: string;
  docs: string;
  /** MCP config hint */
  mcp?: string;
  /** The literal next request to make */
  next?: string;
}

/**
 * The teaching error envelope every 4xx uses
 */
export interface TeachingError {
  error: ErrorCode;
  message: string;
  fix?: TeachingFix;
  requestId: string;
  details?: unknown;
}

export const ANS_LINKS = {
  docs: 'https://ans-registry.org/skill.md',
  register: 'https://ans-registry.org/register',
  skill: 'https://ans-registry.org/skill.md',
  verify: 'https://api.ans-registry.org/v1/verify/',
  mcp: 'npx -y ans-mcp',
} as const;

/** The `_ans` block carried on every public JSON response */
export const ANS_BLOCK = {
  docs: ANS_LINKS.docs,
  register: ANS_LINKS.register,
  skill: ANS_LINKS.skill,
  verify: ANS_LINKS.verify,
} as const;

export const REGISTER_FIX: TeachingFix = {
  url: ANS_LINKS.register,
  command: 'npx -y ans-mcp register --name "<name>"',
  docs: ANS_LINKS.docs,
  mcp: ANS_LINKS.mcp,
};

/** Value of the `Link` header on every error response */
export const HELP_LINK_HEADER = `<${ANS_LINKS.skill}>; rel="help"`;

/**
 * Build a teaching error envelope
 */
export function teachingError(
  error: ErrorCode,
  message: string,
  requestId: string,
  extra: { fix?: TeachingFix; details?: unknown } = {}
): TeachingError {
  const out: TeachingError = { error, message, requestId };
  if (extra.fix) out.fix = extra.fix;
  if (extra.details !== undefined) out.details = extra.details;
  return out;
}

export function isErrorCode(s: unknown): s is ErrorCode {
  return typeof s === 'string' && (ERROR_CODES as readonly string[]).includes(s);
}

/**
 * Error class carrying a teaching envelope, for throwing inside handlers
 */
export class AnsError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fix?: TeachingFix;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; fix?: TeachingFix; details?: unknown } = {}
  ) {
    super(message);
    this.name = 'AnsError';
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code];
    this.fix = options.fix;
    this.details = options.details;
  }

  toEnvelope(requestId: string): TeachingError {
    return teachingError(this.code, this.message, requestId, { fix: this.fix, details: this.details });
  }
}
