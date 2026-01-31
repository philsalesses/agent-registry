import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAgent, getReputation, getAttestationsFor, Agent, Attestation } from '@/lib/api';

function StatusBadge({ status }: { status: Agent['status'] }) {
  const config = {
    online: { color: 'bg-green-500', label: 'Online' },
    offline: { color: 'bg-gray-400', label: 'Offline' },
    maintenance: { color: 'bg-yellow-500', label: 'Maintenance' },
    unknown: { color: 'bg-gray-300', label: 'Unknown' },
  };
  const { color, label } = config[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function TypeBadge({ type }: { type: Agent['type'] }) {
  const colors = {
    assistant: 'bg-blue-100 text-blue-800',
    autonomous: 'bg-purple-100 text-purple-800',
    tool: 'bg-orange-100 text-orange-800',
    service: 'bg-green-100 text-green-800',
  };
  return (
    <span className={`text-sm px-3 py-1 rounded-full ${colors[type]}`}>
      {type}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">{title}</h2>
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
    
    // Fetch attester names
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to ANS
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Profile Header */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold text-3xl shrink-0">
              {agent.avatar ? (
                <img src={agent.avatar} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                agent.name.charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-gray-900">{agent.name}</h1>
                {agent.verified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
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
                  <span className="text-sm text-gray-500">by {agent.operatorName}</span>
                )}
              </div>
              {agent.description && (
                <p className="text-gray-600 mt-3">{agent.description}</p>
              )}
              {agent.homepage && (
                <a 
                  href={agent.homepage} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-block mt-3 text-sm text-blue-600 hover:underline"
                >
                  {agent.homepage} ↗
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Trust Score */}
        {reputation && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Trust Score</h2>
              <Link 
                href={`/attest?subject=${agent.id}`}
                className="text-sm text-blue-600 hover:underline"
              >
                + Attest
              </Link>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-4xl font-bold text-gray-900">{reputation.trustScore}</div>
                <div className="text-sm text-gray-500">/ 100</div>
              </div>
              <div className="flex-1">
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="bg-gradient-to-r from-yellow-400 via-green-500 to-green-600 h-3 rounded-full transition-all"
                    style={{ width: `${reputation.trustScore}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Behavior: {reputation.breakdown?.behaviorScore || 0}</span>
                  <span>Capability: {reputation.breakdown?.capabilityScore || 0}</span>
                  <span>Attesters: {reputation.breakdown?.uniqueAttesters || 0}</span>
                </div>
              </div>
            </div>
            {reputation.attestationCounts?.total > 0 && (
              <p className="text-sm text-gray-500 mt-3">
                Based on {reputation.attestationCounts.total} attestation{reputation.attestationCounts.total !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {/* Attestations - Who vouched for this agent */}
        {attestations.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Vouched By
            </h2>
            <div className="space-y-3">
              {attestations.slice(0, 10).map((attestation) => (
                <div key={attestation.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-3">
                    <Link 
                      href={`/agent/${attestation.attesterId}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {attesterNames[attestation.attesterId] || attestation.attesterId}
                    </Link>
                    <span className="text-sm text-gray-500">
                      {attestation.claimType === 'behavior' 
                        ? `rated ${attestation.claimValue}/100`
                        : attestation.claimType === 'capability'
                        ? `verified ${attestation.claimCapabilityId}`
                        : attestation.claimType}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(attestation.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
            {attestations.length > 10 && (
              <p className="text-sm text-gray-500 mt-3">
                + {attestations.length - 10} more attestations
              </p>
            )}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Tags */}
          {agent.tags.length > 0 && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-2">
                {agent.tags.map((tag) => (
                  <span key={tag} className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-sm">
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
              <code className="text-sm bg-gray-100 px-3 py-2 rounded block overflow-x-auto">
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
                    <span className="text-sm font-medium text-gray-700 uppercase w-20">{pm.type}</span>
                    <code className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded truncate flex-1">
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
                <dt className="text-gray-500">Agent ID</dt>
                <dd className="font-mono text-gray-900">{agent.id}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Registered</dt>
                <dd className="text-gray-900">{new Date(agent.createdAt).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Last Updated</dt>
                <dd className="text-gray-900">{new Date(agent.updatedAt).toLocaleDateString()}</dd>
              </div>
              {agent.lastSeen && (
                <div>
                  <dt className="text-gray-500">Last Seen</dt>
                  <dd className="text-gray-900">{new Date(agent.lastSeen).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </Section>
        </div>

        {/* Public Key */}
        <div className="mt-6">
          <Section title="Public Key">
            <code className="text-xs bg-gray-100 px-3 py-2 rounded block overflow-x-auto break-all">
              {agent.publicKey}
            </code>
          </Section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-3xl mx-auto px-4 py-8 text-center">
          <p className="text-sm text-gray-500">Agent Name Service — DNS for AI Agents</p>
          <p className="text-sm text-gray-500 mt-1">
            Built with 🤖 by <a href="https://ans-registry.org/agent/ag_0QsEpQdgMo6bJrEF" className="text-blue-600 hover:underline">Good Will</a> & <a href="https://philsalesses.com" className="text-blue-600 hover:underline">Phil Salesses</a>
          </p>
          
          {/* Donation */}
          <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg inline-block">
            <p className="text-sm font-medium text-amber-900">💛 Like what we're building?</p>
            <p className="text-sm text-amber-700 mt-1">Support us to keep it going:</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className="text-xs text-amber-600 font-medium">BTC:</span>
              <code className="text-xs bg-amber-100 px-2 py-1 rounded font-mono text-amber-800 select-all">
                38fpnNAJ3VxMwY3fu2duc5NZHnsayr1rCk
              </code>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
