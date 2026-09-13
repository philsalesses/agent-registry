/**
 * The ANS marks. Drawn for this system: perforation, stitching and the tear.
 * No icon pack. Every mark is centred on its own viewBox and inherits currentColor.
 */

type MarkProps = { size?: number; className?: string; title?: string };

/** A perforated seal: the stamp a receipt gets when it is sealed into both chains */
export function SealMark({ size = 16, className, title = 'sealed' }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} role="img" aria-label={title}>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1.6 2.3" />
      <circle cx="8" cy="8" r="2.25" fill="currentColor" />
    </svg>
  );
}

/** An open seal ring: a receipt that is still moving */
export function OpenMark({ size = 16, className, title = 'open' }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} role="img" aria-label={title}>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1.6 2.3" />
    </svg>
  );
}

/** Vertical stitching that joins receipts in a chain. Fills its container's height. */
export function ChainStitch({ className }: { className?: string }) {
  return (
    <svg width="4" height="100%" className={className} aria-hidden="true" preserveAspectRatio="none">
      <line x1="2" y1="3" x2="2" y2="100%" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.1 7" />
    </svg>
  );
}

/** Outward arrow for links that leave the page */
export function OutArrow({ size = 12, className }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" className={className} aria-hidden="true">
      <path d="M3.25 8.75 8.5 3.5M4.25 3.25H8.75V7.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The clip that holds a ticket on the rail */
export function RailClip({ className }: { className?: string }) {
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" className={className} aria-hidden="true">
      <rect x="1" y="0" width="20" height="10" rx="1.5" fill="#24392d" />
      <rect x="1" y="0.5" width="20" height="1" fill="rgb(238 241 234 / 0.18)" />
      <rect x="7" y="9" width="8" height="5" rx="1" fill="#1a2c22" />
    </svg>
  );
}
