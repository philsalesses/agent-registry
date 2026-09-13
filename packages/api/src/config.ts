import { FEE_BPS } from 'ans-core';

/**
 * Typed environment loader. Import `config` everywhere; call `loadConfig` in
 * tests to build a config from a custom env.
 */
export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  /** HMAC secret for web session tokens; >= 32 chars. Loaded from registry_secrets at boot when not in the environment. */
  sessionSecret: string;
  /** true when SESSION_SECRET came from the environment */
  sessionSecretFromEnv: boolean;
  /** Admin routes answer 503 when unset */
  adminSecret?: string;
  /** Registry Ed25519 keypair (base64). Ephemeral in development when unset. */
  registryPrivateKey?: string;
  registryPublicKey?: string;
  /** Fee frozen onto every receipt at open (basis points) */
  feeBps: number;
  stripeEnabled: boolean;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  /** Incoming-webhook URL that receives JSON {text} alerts */
  adminAlertUrl?: string;
  publicWebUrl: string;
  publicApiUrl: string;
  /** Number of trusted reverse-proxy hops in X-Forwarded-For */
  trustProxyHops: number;
  corsOrigins: string[];
  /** ANS_DISABLE_JOBS=1: no clock, no nightly jobs (tests) */
  disableJobs: boolean;
}

const DEFAULT_CORS_ORIGINS = [
  'https://ans-registry.org',
  'https://www.ans-registry.org',
  'https://web-gold-beta-31.vercel.app',
  'http://localhost:3000',
];

const DEV_SESSION_SECRET = 'ans-development-session-secret-do-not-use-in-production';

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function warn(message: string): void {
  if (process.env.ANS_QUIET === '1') return;
  console.warn(`[config] ${message}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawEnv = env.NODE_ENV;
  const nodeEnv: Config['nodeEnv'] = rawEnv === 'production' ? 'production' : rawEnv === 'test' ? 'test' : 'development';
  const isProduction = nodeEnv === 'production';

  let sessionSecret = env.SESSION_SECRET ?? '';
  let sessionSecretFromEnv = sessionSecret.length > 0;
  if (sessionSecret && sessionSecret.length < 32) {
    if (isProduction) throw new Error('SESSION_SECRET must be at least 32 characters');
    warn('SESSION_SECRET is shorter than 32 characters; production will refuse to start with it');
  }
  if (!sessionSecret) {
    if (isProduction) {
      // ensureSecrets() loads or generates it from registry_secrets before the server listens
      warn('SESSION_SECRET is not set; a generated secret stored in the database will be used');
    } else {
      sessionSecret = DEV_SESSION_SECRET;
      sessionSecretFromEnv = true;
      warn('SESSION_SECRET is not set; using an insecure development default');
    }
  }

  const registryPrivateKey = env.REGISTRY_PRIVATE_KEY || undefined;
  const registryPublicKey = env.REGISTRY_PUBLIC_KEY || undefined;
  if ((!registryPrivateKey || !registryPublicKey) && process.env.ANS_QUIET !== '1') {
    warn(isProduction
      ? 'REGISTRY_PRIVATE_KEY / REGISTRY_PUBLIC_KEY not set; a generated keypair stored in the database will be used'
      : 'REGISTRY_PRIVATE_KEY / REGISTRY_PUBLIC_KEY not set; an ephemeral registry keypair will be generated');
  }

  const adminSecret = env.ADMIN_SECRET || undefined;
  if (!adminSecret) warn('ADMIN_SECRET is not set; admin routes answer 503');

  const stripeEnabled = bool(env.STRIPE_ENABLED, false);
  const stripeSecretKey = env.STRIPE_SECRET_KEY || undefined;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET || undefined;
  if (stripeEnabled && (!stripeSecretKey || !stripeWebhookSecret)) {
    throw new Error('STRIPE_ENABLED requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
  }

  const extraOrigins = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  return {
    nodeEnv,
    isProduction,
    port: int(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL || 'postgres://localhost:5433/agent_registry_dev',
    sessionSecret,
    sessionSecretFromEnv,
    adminSecret,
    registryPrivateKey,
    registryPublicKey,
    feeBps: int(env.FEE_BPS, FEE_BPS),
    stripeEnabled,
    stripeSecretKey,
    stripeWebhookSecret,
    adminAlertUrl: env.ADMIN_ALERT_URL || undefined,
    publicWebUrl: (env.PUBLIC_WEB_URL || 'https://ans-registry.org').replace(/\/+$/, ''),
    publicApiUrl: (env.PUBLIC_API_URL || 'https://api.ans-registry.org').replace(/\/+$/, ''),
    trustProxyHops: Math.max(0, int(env.TRUST_PROXY_HOPS, 1)),
    corsOrigins: Array.from(new Set([...DEFAULT_CORS_ORIGINS, ...extraOrigins])),
    disableJobs: env.ANS_DISABLE_JOBS === '1',
  };
}

export const config: Config = loadConfig();
