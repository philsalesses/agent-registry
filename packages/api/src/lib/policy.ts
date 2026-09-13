import { AnsError, REGISTER_FIX, type AgentPolicy, type CreditClass } from 'ans-core';
import { DEFAULT_AGENT_POLICY } from '../db/schema';
import { config } from '../config';
import { resolveAgent, type AgentRow } from './auth';

/**
 * Operator policy (docs/DESIGN.md section 8 and 14.2):
 *   unregistered caller or counterparty -> 428 registration_required
 *   registered but below policy.minTrust -> 403 trust_below_minimum
 *   sandbox credit to a provider that refuses it -> 409 sandbox_not_accepted
 */

export function policyOf(agent: Pick<AgentRow, 'policy'>): AgentPolicy {
  const p = (agent.policy ?? {}) as Partial<AgentPolicy>;
  return {
    requireRegistered: typeof p.requireRegistered === 'boolean' ? p.requireRegistered : DEFAULT_AGENT_POLICY.requireRegistered,
    minTrust: typeof p.minTrust === 'number' ? Math.max(0, Math.min(100, Math.round(p.minTrust))) : DEFAULT_AGENT_POLICY.minTrust,
    acceptSandbox: typeof p.acceptSandbox === 'boolean' ? p.acceptSandbox : DEFAULT_AGENT_POLICY.acceptSandbox,
  };
}

/** The public fields of an agent's policy */
export function publicPolicy(agent: Pick<AgentRow, 'policy'>): AgentPolicy {
  return policyOf(agent);
}

export function profileUrl(agent: Pick<AgentRow, 'id' | 'handle'>): string {
  return `${config.publicWebUrl}/agent/${agent.handle ?? agent.id}`;
}

/** Resolve an id or handle, or throw 428 registration_required with the register fix. */
export async function requireRegisteredAgent(idOrHandle: string, role: string = 'counterparty'): Promise<AgentRow> {
  const agent = await resolveAgent(idOrHandle);
  if (!agent) {
    throw new AnsError('registration_required', `The ${role} ${idOrHandle} is not a registered ANS agent`, {
      fix: {
        ...REGISTER_FIX,
        next: `Ask the ${role} to register (or name them with counterparty.hint to get a claim link instead)`,
      },
      details: { [role]: idOrHandle },
    });
  }
  return agent;
}

/** 403 when `sender` is below `recipient`'s minTrust. */
export function assertTrustFor(recipient: AgentRow, sender: Pick<AgentRow, 'id' | 'trustScore'>): void {
  const policy = policyOf(recipient);
  if (policy.minTrust > 0 && sender.trustScore < policy.minTrust) {
    throw new AnsError('trust_below_minimum', `@${recipient.handle ?? recipient.id} only works with agents whose trust score is at least ${policy.minTrust}`, {
      details: { required: policy.minTrust, actual: sender.trustScore, profile: profileUrl(recipient) },
      fix: {
        docs: 'https://ans-registry.org/docs/trust',
        next: 'Build trust with confirmed receipts from other agents, then try again',
      },
    });
  }
}

/** 409 when a sandbox-class payment targets a provider (or offer) that refuses sandbox credit. */
export function assertSandboxAccepted(provider: AgentRow, creditClass: CreditClass, offerAcceptsSandbox: boolean = true): void {
  if (creditClass !== 'sandbox') return;
  if (!policyOf(provider).acceptSandbox || !offerAcceptsSandbox) {
    throw new AnsError('sandbox_not_accepted', `@${provider.handle ?? provider.id} does not accept sandbox credit`, {
      details: { provider: provider.id, acceptSandbox: false },
      fix: { docs: 'https://ans-registry.org/docs/money', next: 'Pay with creditClass "cash" (top up at /wallet)' },
    });
  }
}
