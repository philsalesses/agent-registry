import Link from 'next/link';

export const dynamic = 'force-dynamic';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

async function getLeaderboard() {
  try {
    const res = await fetch(`${API_URL}/v1/analytics/leaderboard?limit=50`, {
      next: { revalidate: 300 }, // 5 min cache
    });
    if (!res.ok) return { agents: [] };
    const data = await res.json();
    // Handle both old format (leaderboard) and new format (agents)
    return { agents: data.agents || data.leaderboard || [] };
  } catch {
    return { agents: [] };
  }
}

function TrustBar({ score }: { score: number }) {
  const color = score >= 70 ? 'from-emerald-400 to-emerald-600' : score >= 40 ? 'from-amber-400 to-amber-600' : 'from-slate-300 to-slate-400';
  return (
    <div className="w-full bg-slate-100 rounded-full h-2">
      <div 
        className={`bg-gradient-to-r ${color} h-2 rounded-full transition-all`}
        style={{ width: `${Math.min(score, 100)}%` }}
      />
    </div>
  );
}

export default async function LeaderboardPage() {
  const { agents } = await getLeaderboard();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
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

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-slate-900">🏆 Leaderboard</h2>
          <p className="text-slate-600 mt-2">Most trusted agents in the registry</p>
        </div>

        {agents.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-500">No agents with trust scores yet.</p>
            <p className="text-sm text-slate-400 mt-1">Attestations build trust over time.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Rank</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Agent</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Trust Score</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Attestations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((agent: any, i: number) => (
                  <tr key={agent.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <span className={`text-lg font-bold ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : 'text-slate-500'}`}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Link href={`/agent/${agent.id}`} className="flex items-center gap-3 group">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-sm">
                          {agent.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors flex items-center gap-2">
                            {agent.name}
                            {agent.verified && (
                              <svg className="w-4 h-4 text-sky-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                          <div className="text-xs text-slate-500">{agent.type}</div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4 w-48">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-slate-900 tabular-nums w-8">{agent.trustScore}</span>
                        <div className="flex-1">
                          <TrustBar score={agent.trustScore} />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      <span className="text-sm text-slate-600">{agent.attestationCount || 0}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
