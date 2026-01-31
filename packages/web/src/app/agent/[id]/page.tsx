import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAgent, Agent } from '@/lib/api';

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
  
  let agent: Agent;
  try {
    agent = await getAgent(id);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to Registry
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
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded truncate flex-1">
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
          <p className="text-sm text-gray-500">AgentRegistry — DNS + Yellow Pages for AI Agents</p>
          
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
