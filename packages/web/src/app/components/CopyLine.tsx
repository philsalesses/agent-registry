'use client';

import { useState } from 'react';

/** Wraps at spaces and never inside a short token such as `--name`; long tokens like URLs break after a slash first. */
function Wrapped({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((part, i) => {
        if (part.length === 0 || /^\s+$/.test(part)) return part;
        if (part.length <= 20) {
          return (
            <span key={i} className="whitespace-nowrap">
              {part}
            </span>
          );
        }
        const pieces = part.split(/(?<=\/)/);
        return (
          <span key={i}>
            {pieces.map((piece, j) => (
              <span key={j}>
                {piece}
                {j < pieces.length - 1 ? <wbr /> : null}
              </span>
            ))}
          </span>
        );
      })}
    </>
  );
}

/**
 * A command or value with a working copy control. The label swaps to "copied"
 * for 1.2 seconds; nothing else moves. Long values wrap instead of hiding past the edge.
 */
export default function CopyLine({
  value,
  label,
  surface = 'ink',
  className = '',
}: {
  value: string;
  label?: string;
  surface?: 'ink' | 'paper';
  className?: string;
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
      <code className="figure min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-[1.55] [overflow-wrap:anywhere]">
        <Wrapped text={value} />
      </code>
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
