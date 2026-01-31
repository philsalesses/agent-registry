'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface EmbedCodes {
  cardUrl: string;
  profileUrl: string;
  markdown: string;
  html: string;
  bbcode: string;
}

export function ShareButton({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [style, setStyle] = useState<'flat' | 'flat-square' | 'badge'>('flat');
  const [embedCodes, setEmbedCodes] = useState<EmbedCodes | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchEmbedCodes = async (selectedStyle: string) => {
    try {
      const res = await fetch(`${API_URL}/v1/agents/${agentId}/card/embed?style=${selectedStyle}`);
      if (res.ok) {
        const data = await res.json();
        setEmbedCodes(data);
      }
    } catch (e) {
      console.error('Failed to fetch embed codes:', e);
    }
  };

  const handleOpen = async () => {
    setIsOpen(true);
    await fetchEmbedCodes(style);
  };

  const handleStyleChange = async (newStyle: 'flat' | 'flat-square' | 'badge') => {
    setStyle(newStyle);
    await fetchEmbedCodes(newStyle);
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  const cardUrl = `${API_URL}/v1/agents/${agentId}/card?style=${style}`;

  return (
    <>
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        Share
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setIsOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Share {agentName}</h2>
                <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Badge Preview */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Preview</label>
                <div className="bg-gray-100 p-4 rounded-lg flex items-center justify-center min-h-[80px]">
                  <img src={cardUrl} alt={`${agentName} badge`} className="max-w-full" />
                </div>
              </div>

              {/* Style Selector */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Style</label>
                <div className="flex gap-2">
                  {(['flat', 'flat-square', 'badge'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStyleChange(s)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        style === s
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Embed Codes */}
              {embedCodes && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Markdown</label>
                    <div className="flex gap-2">
                      <code className="flex-1 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                        {embedCodes.markdown}
                      </code>
                      <button
                        onClick={() => handleCopy(embedCodes.markdown, 'markdown')}
                        className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
                      >
                        {copied === 'markdown' ? '✓' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">HTML</label>
                    <div className="flex gap-2">
                      <code className="flex-1 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                        {embedCodes.html}
                      </code>
                      <button
                        onClick={() => handleCopy(embedCodes.html, 'html')}
                        className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
                      >
                        {copied === 'html' ? '✓' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Image URL</label>
                    <div className="flex gap-2">
                      <code className="flex-1 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                        {embedCodes.cardUrl}
                      </code>
                      <button
                        onClick={() => handleCopy(embedCodes.cardUrl, 'url')}
                        className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
                      >
                        {copied === 'url' ? '✓' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Profile URL</label>
                    <div className="flex gap-2">
                      <code className="flex-1 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                        {embedCodes.profileUrl}
                      </code>
                      <button
                        onClick={() => handleCopy(embedCodes.profileUrl, 'profile')}
                        className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
                      >
                        {copied === 'profile' ? '✓' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
