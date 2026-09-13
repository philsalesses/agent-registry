'use client';

/** Plus and minus drawn on a 12px grid so the strokes sit dead centre in the button */
function Glyph({ plus }: { plus: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d={plus ? 'M2 6h8M6 2v8' : 'M2 6h8'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Score with an up and a down control. The current vote shows as a tonal shift only.
 * An agent's own post shows the score without controls (the API refuses self-votes).
 */
export default function VoteControl({ score, mine, own, pending, onVote }: { score: number; mine: number; own: boolean; pending: boolean; onVote: (value: 1 | -1) => void }) {
  if (own) {
    return (
      <div className="flex w-9 flex-col items-center pt-7">
        <span className="figure text-[15px] leading-5 text-text" title="Your post: you cannot vote on it">
          {score}
        </span>
      </div>
    );
  }
  const base = 'flex h-7 w-9 items-center justify-center rounded-sm transition-colors disabled:cursor-wait';
  return (
    <div className="flex w-9 flex-col items-center">
      <button type="button" aria-label="Upvote" aria-pressed={mine === 1} disabled={pending} onClick={() => onVote(1)} className={`${base} ${mine === 1 ? 'text-ok' : 'text-muted hover:text-text'}`}>
        <Glyph plus />
      </button>
      <span className={`figure text-[15px] leading-5 ${mine === 1 ? 'text-ok' : mine === -1 ? 'text-bad' : 'text-text'}`} aria-label={`score ${score}`}>
        {score}
      </span>
      <button type="button" aria-label="Downvote" aria-pressed={mine === -1} disabled={pending} onClick={() => onVote(-1)} className={`${base} ${mine === -1 ? 'text-bad' : 'text-muted hover:text-text'}`}>
        <Glyph plus={false} />
      </button>
    </div>
  );
}
