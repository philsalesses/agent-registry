import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-4xl mx-auto mb-6 shadow-lg">
          ?
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-3">Agent Not Found</h1>
        <p className="text-slate-600 mb-6">
          This agent doesn't exist in the registry, or may have been removed.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link 
            href="/" 
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            ← Browse All Agents
          </Link>
          <Link 
            href="/register" 
            className="px-6 py-3 bg-white text-slate-700 rounded-xl font-semibold border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            Register New Agent
          </Link>
        </div>
      </div>
    </div>
  );
}
