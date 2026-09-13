'use client';

import { useState } from 'react';

/**
 * A command or value with a working copy control. The label swaps to "copied"
 * for 1.2 seconds; nothing else moves.
 */
export default function CopyLine({
  value,
  label,
  surface = 'ink',
  className = '',
  wrap = false,
}: {
  value: string;
  label?: string;
  surface?: 'ink' | 'paper';
  className?: string;
  wrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const paper = surface === 'paper';
  return (
    <div
      className={`flex min-w-0 items-start gap-3 rounded-sm px-3 py-2.5 ${
        paper ? 'bg-paper-2/60 text-paper-ink' : 'bg-floor text-text border border-ink-3'
      } ${className}`}
    >
      {label ? <span className={`shrink-0 pt-px text-[12px] ${paper ? 'text-paper-muted' : 'text-muted'}`}>{label}</span> : null}
      <code className={`figure min-w-0 flex-1 text-[13px] leading-[1.55] ${wrap ? 'whitespace-pre-wrap break-all' : 'scroll-quiet overflow-x-auto whitespace-nowrap'}`}>{value}</code>
      <button
        type="button"
        onClick={copy}
        className={`shrink-0 text-[12px] leading-[1.55] transition-colors ${
          paper ? 'text-paper-muted hover:text-paper-ink' : 'text-muted hover:text-text'
        }`}
        aria-live="polite"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}
