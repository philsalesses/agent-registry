import Link from 'next/link';

export const dynamic = 'force-dynamic';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

async function getRecentActivity() {
  try {
    // Fetch recent agents and attestations in parallel
    const [agentsRes, attestationsRes] = await Promise.all([
      fetch(`${API_URL}/v1/agents?limit=20`, { next: { revalidate: 60 } }),
      fetch(`${API_URL}/v1/attestations?limit=30`, { next: { revalidate: 60 } }),
    ]);
    
    const agents = agentsRes.ok ? (await agentsRes.json()).agents || [] : [];
    const attestations = attestationsRes.ok ? (await attestationsRes.json()).attestations || [] : [];
    
    // Combine into activity feed
    const activity: any[] = [
      ...agents.map((a: any) => ({
        type: 'registration',
        agent: a,
        timestamp: a.createdAt,
      })),
      ...attestations.map((att: any) => ({
        type: 'attestation',
        attestation: att,
        timestamp: att.createdAt,
      })),
    ];
    
    // Sort by timestamp descending
    activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return activity.slice(0, 50);
  } catch {
    return [];
  }
}

async function getAgentName(id: string): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/v1/agents/${id}`, { next: { revalidate: 300 } });
    if (res.ok) {
      const agent = await res.json();
      return agent.name || id;
    }
  } catch {}
  return id;
}

function TimeAgo({ timestamp }: { timestamp: string }) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return <span>just now</span>;
  if (minutes < 60) return <span>{minutes}m ago</span>;
  if (hours < 24) return <span>{hours}h ago</span>;
  if (days < 7) return <span>{days}d ago</span>;
  return <span>{date.toLocaleDateString()}</span>;
}

export default async function ActivityPage() {
  const activity = await getRecentActivity();
  
  // Pre-fetch agent names for attestations
  const agentNames: Record<string, string> = {};
  const agentIds = new Set<string>();
  activity.forEach(item => {
    if (item.type === 'attestation') {
      agentIds.add(item.attestation.attesterId);
      agentIds.add(item.attestation.subjectId);
    }
  });
  
  await Promise.all([...agentIds].map(async (id) => {
    agentNames[id] = await getAgentName(id);
  }));

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              A
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Agent Name Service</h1>
              <p className="text-xs text-slate-500 -mt-0.5">ans-registry.org</p>
            </div>
          </Link>
          <Link 
            href="/" 
            className="text-sm text-slate-600 hover:text-indigo-600"
          >
            ← Back to Registry
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-slate-900">📡 Activity Feed</h2>
          <p className="text-slate-600 mt-2">Recent registrations and attestations</p>
        </div>

        {activity.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-500">No activity yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activity.map((item, i) => (
              <div 
                key={i}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:border-slate-300 transition-colors"
              >
                {item.type === 'registration' ? (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 text-lg">
                      🤖
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-slate-900">
                          <Link href={`/agent/${item.agent.id}`} className="font-semibold hover:text-indigo-600">
                            {item.agent.name}
                          </Link>
                          {' '}registered
                        </p>
                        <span className="text-xs text-slate-400">
                          <TimeAgo timestamp={item.timestamp} />
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">
                        {item.agent.type} {item.agent.operatorName ? `by ${item.agent.operatorName}` : ''}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-sky-100 flex items-center justify-center text-sky-600 text-lg">
                      ✓
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-slate-900">
                          <Link href={`/agent/${item.attestation.attesterId}`} className="font-semibold hover:text-indigo-600">
                            {agentNames[item.attestation.attesterId] || item.attestation.attesterId}
                          </Link>
                          {' '}attested to{' '}
                          <Link href={`/agent/${item.attestation.subjectId}`} className="font-semibold hover:text-indigo-600">
                            {agentNames[item.attestation.subjectId] || item.attestation.subjectId}
                          </Link>
                        </p>
                        <span className="text-xs text-slate-400">
                          <TimeAgo timestamp={item.timestamp} />
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">
                        {item.attestation.claimType === 'behavior' 
                          ? `Trust rating: ${item.attestation.claimValue}/100`
                          : item.attestation.claimType === 'capability'
                          ? `Verified capability: ${item.attestation.claimCapabilityId}`
                          : item.attestation.claimType}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
