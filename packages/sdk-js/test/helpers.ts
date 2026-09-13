import { serve } from '@hono/node-server';
import { createApp } from '../../api/src/app';
import { migrationClient as pg } from '../../api/src/db';
import { runMigrations } from '../../api/src/lib/migrate';
import { agentAccountIds, deleteRateLimitKeys, deleteTestAgents, purgeLedger } from '../../api/src/__tests__/helpers';
import { ANSClient, type RegisterInput, type RegisterResult } from '../src';

export interface TestApi {
  baseUrl: string;
  close(): Promise<void>;
}

/** The real API (createApp, unless another fetch app is given) on a random local port, against the SDK test database */
export async function startApi(app: { fetch: (request: Request) => Response | Promise<Response> } = createApp()): Promise<TestApi> {
  await runMigrations();
  await deleteRateLimitKeys(['register:ip:', 'global:']);
  return startServer((request) => app.fetch(request));
}

/** Serve any fetch handler (a provider endpoint) on a random local port */
export function listen(fetchHandler: (request: Request) => Response | Promise<Response>): Promise<TestApi> {
  return startServer(fetchHandler);
}

function startServer(fetchHandler: (request: Request) => Response | Promise<Response>): Promise<TestApi> {
  return new Promise<TestApi>((resolveStart, reject) => {
    const server = serve({ fetch: fetchHandler, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolveStart({
        baseUrl: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise<void>((done) => {
            const s = server as unknown as { closeAllConnections?: () => void; close: (cb: () => void) => void };
            s.closeAllConnections?.();
            s.close(() => done());
          }),
      });
    });
    server.on('error', reject);
  });
}

/** Which not-yet-finished routers are mounted (a stub answers 501 not_implemented) */
export async function mountedRoutes(): Promise<{ offers: boolean; invoke: boolean; wallet: boolean }> {
  const app = createApp();
  const [offers, invoke, wallet] = await Promise.all([
    app.request('/v1/offers'),
    app.request('/v1/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    app.request('/v1/wallet'),
  ]);
  return { offers: offers.status !== 501, invoke: invoke.status !== 501, wallet: wallet.status !== 501 };
}

export function suffix(n = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Registers a fresh agent through the SDK and remembers it for cleanup */
export class AgentTracker {
  readonly ids: string[] = [];

  constructor(private readonly baseUrl: string) {}

  async register(prefix: string, extra: Partial<RegisterInput> = {}): Promise<{ client: ANSClient; res: RegisterResult }> {
    // register:ip allows 5 per hour per address; every test run registers more than that from 127.0.0.1
    await deleteRateLimitKeys(['register:ip:']);
    const client = new ANSClient({ baseUrl: this.baseUrl });
    const res = await client.register({ name: `SDK test ${prefix}`, handle: `${prefix}-${suffix()}`, type: 'assistant', ...extra });
    this.ids.push(res.agent.id);
    return { client, res };
  }

  /** Remove every row the registered agents produced: receipts, ratings, events, ledger, messages, keys, agents */
  async cleanup(): Promise<void> {
    const ids = this.ids;
    if (ids.length === 0) return;
    const receiptRows = await pg<{ id: string }[]>`select id from receipts where client_id = any(${ids}) or provider_id = any(${ids}) or initiator_id = any(${ids})`;
    const rids = receiptRows.map((r) => r.id);
    const refs = [...rids, ...ids];
    const txnRows = await pg<{ id: string }[]>`select id from ledger_txns where ref_id = any(${refs}) or actor_agent_id = any(${ids})`;
    await purgeLedger({ txnIds: txnRows.map((t) => t.id), accountIds: await agentAccountIds(ids) });
    await pg`delete from messages where from_agent_id = any(${ids}) or to_agent_id = any(${ids})`;
    if (rids.length > 0) {
      await pg`delete from ratings where receipt_id = any(${rids})`;
      await pg`delete from receipt_events where receipt_id = any(${rids})`;
      await pg`delete from funnel_events where receipt_id = any(${rids})`;
      await pg`delete from receipts where id = any(${rids})`;
    }
    await pg`delete from ratings where rater_id = any(${ids}) or subject_id = any(${ids})`;
    await pg`delete from funnel_events where agent_id = any(${ids})`;
    await pg`delete from notifications where agent_id = any(${ids})`;
    await pg`delete from payout_requests where agent_id = any(${ids})`;
    const offerRows = await pg<{ id: string }[]>`select id from offers where agent_id = any(${ids})`;
    const oids = offerRows.map((o) => o.id);
    if (oids.length > 0) {
      await pg`delete from funnel_events where offer_id = any(${oids})`;
      await pg`delete from offers where id = any(${oids})`;
    }
    await deleteRateLimitKeys(['register:ip:', 'global:', 'receipt:', 'hint:']);
    await deleteTestAgents(ids);
  }
}
