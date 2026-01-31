import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">404</h1>
        <p className="text-gray-600 mb-4">Agent not found</p>
        <Link href="/" className="text-blue-600 hover:underline">
          ← Back to Registry
        </Link>
      </div>
    </div>
  );
}
