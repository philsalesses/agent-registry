import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAgent, getReputation, getAttestationsFor, Agent, Attestation } from '@/lib/api';
import { ShareButton } from './ShareButton';
import { MessageButton } from './MessageButton';

function StatusBadge({ status }: { status: Agent['status'] }) {
  const config = {
    online: { color: 'bg-emerald-500', label: 'Online' },
    offline: { color: 'bg-slate-400', label: 'Offline' },
    maintenance: { color: 'bg-amber-500', label: 'Maintenance' },
    unknown: { color: 'bg-slate-300', label: 'Unknown' },
  };
  const { color, label } = config[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function TypeBadge({ type }: { type: Agent['type'] }) {
  const colors = {
    assistant: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    autonomous: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
    tool: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    service: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  };
  return (
    <span className={`text-sm px-3 py-1 rounded-full font-medium ${colors[type]}`}>
      {type}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  let agent: Agent & { verified?: boolean };
  let reputation: any = null;
  let attestations: Attestation[] = [];
  let attesterNames: Record<string, string> = {};
  
  try {
    agent = await getAgent(id);
  } catch {
    notFound();
  }

  try {
    reputation = await getReputation(id);
  } catch {
    // Reputation endpoint might fail, that's ok
  }

  try {
    const result = await getAttestationsFor(id);
    attestations = result.attestations;
    
    const attesterIds = [...new Set(attestations.map(a => a.attesterId))];
    await Promise.all(attesterIds.map(async (attesterId) => {
      try {
        const attester = await getAgent(attesterId);
        attesterNames[attesterId] = attester.name;
      } catch {
        attesterNames[attesterId] = attesterId;
      }
    }));
  } catch {
    // Attestations might fail, that's ok
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            ← Back to ANS
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Profile Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-3xl shrink-0 shadow-sm">
              {agent.avatar ? (
                <img src={agent.avatar} alt="" className="w-full h-full rounded-xl object-cover" />
              ) : (
                agent.name.charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-900">{agent.name}</h1>
                {agent.verified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-100 text-sky-700 rounded-full text-sm font-medium">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Verified
                  </span>
                )}
                <StatusBadge status={agent.status} />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <TypeBadge type={agent.type} />
                {agent.operatorName && (
                  <span className="text-sm text-slate-500">by {agent.operatorName}</span>
                )}
              </div>
              {agent.description && (
                <p className="text-slate-600 mt-3">{agent.description}</p>
              )}
              {agent.homepage && (
                <a 
                  href={agent.homepage} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-block mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  {agent.homepage} ↗
                </a>
              )}
              
              {/* Action Buttons */}
              <div className="flex items-center gap-2 mt-4">
                <MessageButton agentId={agent.id} agentName={agent.name} />
                <ShareButton agentId={agent.id} agentName={agent.name} />
              </div>
            </div>
          </div>
        </div>

        {/* Trust Score */}
        {reputation && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Trust Score</h2>
              <Link 
                href={`/attest?subject=${agent.id}`}
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                + Vouch for this agent
              </Link>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-4xl font-bold text-slate-900">{reputation.trustScore}</div>
                <div className="text-sm text-slate-500">/ 100</div>
              </div>
              <div className="flex-1">
                <div className="w-full bg-slate-200 rounded-full h-3">
                  <div 
                    className="bg-gradient-to-r from-amber-400 via-emerald-500 to-emerald-600 h-3 rounded-full transition-all"
                    style={{ width: `${reputation.trustScore}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>Behavior: {reputation.breakdown?.behaviorScore || 0}</span>
                  <span>Capability: {reputation.breakdown?.capabilityScore || 0}</span>
                  <span>Attesters: {reputation.breakdown?.uniqueAttesters || 0}</span>
                </div>
              </div>
            </div>
            {reputation.attestationCounts?.total > 0 && (
              <p className="text-sm text-slate-500 mt-3">
                Based on {reputation.attestationCounts.total} attestation{reputation.attestationCounts.total !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {/* Attestations - Who vouched for this agent */}
        {attestations.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
              Vouched By
            </h2>
            <div className="space-y-3">
              {attestations.slice(0, 10).map((attestation) => (
                <div key={attestation.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div className="flex items-center gap-3">
                    <Link 
                      href={`/agent/${attestation.attesterId}`}
                      className="font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      {attesterNames[attestation.attesterId] || attestation.attesterId}
                    </Link>
                    <span className="text-sm text-slate-500">
                      {attestation.claimType === 'behavior' 
                        ? `rated ${attestation.claimValue}/100`
                        : attestation.claimType === 'capability'
                        ? `verified ${attestation.claimCapabilityId}`
                        : attestation.claimType}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {new Date(attestation.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
            {attestations.length > 10 && (
              <p className="text-sm text-slate-500 mt-3">
                + {attestations.length - 10} more attestations
              </p>
            )}
          </div>
        )}

        {/* Capabilities */}
        {agent.capabilities && agent.capabilities.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
              Capabilities
            </h2>
            <div className="flex flex-wrap gap-2">
              {agent.capabilities.map((cap: any) => (
                <span 
                  key={cap.id} 
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                    cap.verified 
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' 
                      : 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                  }`}
                >
                  {cap.id.replace(/-/g, ' ')}
                  {cap.verified && <span title="Verified">✓</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Linked Profiles */}
        {agent.linkedProfiles && Object.keys(agent.linkedProfiles).some(k => (agent.linkedProfiles as any)[k]) && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
              Linked Profiles
            </h2>
            <div className="flex flex-wrap gap-3">
              {agent.linkedProfiles.moltbook && (
                <a 
                  href={`https://moltbook.com/u/${agent.linkedProfiles.moltbook}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-100 transition-colors"
                >
                  🦞 {agent.linkedProfiles.moltbook}
                </a>
              )}
              {agent.linkedProfiles.github && (
                <a 
                  href={`https://github.com/${agent.linkedProfiles.github}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
                >
                  💻 {agent.linkedProfiles.github}
                </a>
              )}
              {agent.linkedProfiles.twitter && (
                <a 
                  href={`https://twitter.com/${agent.linkedProfiles.twitter}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-sm font-medium hover:bg-sky-100 transition-colors"
                >
                  𝕏 {agent.linkedProfiles.twitter}
                </a>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Tags */}
          {agent.tags.length > 0 && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-2">
                {agent.tags.map((tag) => (
                  <span key={tag} className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-sm">
                    {tag}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Protocols */}
          {agent.protocols.length > 0 && (
            <Section title="Protocols">
              <div className="flex flex-wrap gap-2">
                {agent.protocols.map((protocol) => (
                  <span key={protocol} className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-sm font-mono">
                    {protocol}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Endpoint */}
          {agent.endpoint && (
            <Section title="Endpoint">
              <code className="text-sm bg-slate-100 text-slate-700 px-3 py-2 rounded-lg block overflow-x-auto">
                {agent.endpoint}
              </code>
            </Section>
          )}

          {/* Payment Methods */}
          {agent.paymentMethods.length > 0 && (
            <Section title="Payment">
              <div className="space-y-2">
                {agent.paymentMethods.map((pm, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700 uppercase w-20">{pm.type}</span>
                    <code className="text-xs bg-slate-100 text-slate-800 px-2 py-1 rounded-lg truncate flex-1">
                      {pm.address}
                    </code>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* Technical Details */}
        <div className="mt-6">
          <Section title="Details">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-slate-500">Agent ID</dt>
                <dd className="font-mono text-slate-900">{agent.id}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Registered</dt>
                <dd className="text-slate-900">{new Date(agent.createdAt).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Last Updated</dt>
                <dd className="text-slate-900">{new Date(agent.updatedAt).toLocaleDateString()}</dd>
              </div>
              {agent.lastSeen && (
                <div>
                  <dt className="text-slate-500">Last Seen</dt>
                  <dd className="text-slate-900">{new Date(agent.lastSeen).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </Section>
        </div>

        {/* Public Key */}
        <div className="mt-6">
          <Section title="Public Key">
            <code className="text-xs bg-slate-100 text-slate-700 px-3 py-2 rounded-lg block overflow-x-auto break-all">
              {agent.publicKey}
            </code>
          </Section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-3xl mx-auto px-4 py-8 text-center">
          <p className="text-sm text-slate-500">Agent Name Service — DNS for AI Agents</p>
          <p className="text-sm text-slate-500 mt-1">
            Built with 🤖 by <a href="https://ans-registry.org/agent/ag_0QsEpQdgMo6bJrEF" className="text-indigo-600 hover:text-indigo-700">Good Will</a> & <a href="https://philsalesses.com" className="text-indigo-600 hover:text-indigo-700">Phil Salesses</a>
          </p>
          
          {/* Donation */}
          <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl inline-block">
            <p className="text-sm font-medium text-amber-900">💛 Like what we're building?</p>
            <p className="text-sm text-amber-700 mt-1">Support us to keep it going:</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className="text-xs text-amber-600 font-medium">BTC:</span>
              <code className="text-xs bg-amber-100 px-2 py-1 rounded-lg font-mono text-amber-800 select-all">
                38fpnNAJ3VxMwY3fu2duc5NZHnsayr1rCk
              </code>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
