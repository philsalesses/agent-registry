import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Shared pieces for the social cards: the ink floor, Tanker, and a paper slip with a torn edge. */

export const OG_SIZE = { width: 1200, height: 630 };

export const INK = '#101814';
export const TEXT = '#e4ebe4';
export const MUTED = '#a3b4a7';
export const PAPER = '#e4ebe4';
export const PAPER_INK = '#18251c';
export const PAPER_MUTED = '#526253';
export const TONES = { ok: '#2e6a3c', wait: '#7a5d12', bad: '#8e3b33', dim: '#526253' } as const;

let fontCache: Promise<Buffer> | null = null;

export function displayFont() {
  if (!fontCache) {
    fontCache = readFile(join(process.cwd(), 'src/og/tanker-regular.ttf')).catch((err) => {
      fontCache = null;
      throw err;
    });
  }
  return fontCache;
}

export async function ogFonts() {
  try {
    const [display, body] = await Promise.all([
      displayFont(),
      readFile(join(process.cwd(), 'node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf')),
    ]);
    return [
      { name: 'Noto Sans', data: body, weight: 400 as const, style: 'normal' as const },
      { name: 'Tanker', data: display, weight: 400 as const, style: 'normal' as const },
    ];
  } catch {
    return [];
  }
}

/** A zigzag strip in paper colour: the torn bottom of a slip */
export function TornEdge({ width, color = PAPER, tooth = 18, depth = 9 }: { width: number; color?: string; tooth?: number; depth?: number }) {
  const teeth = Math.ceil(width / tooth);
  let d = `M0 0 H${width} V0`;
  for (let i = teeth; i >= 0; i--) {
    const x = Math.min(i * tooth, width);
    const mid = Math.max(x - tooth / 2, 0);
    d += ` L${x} 0 L${mid} ${depth}`;
  }
  d += ' L0 0 Z';
  return (
    <svg width={width} height={depth} viewBox={`0 0 ${width} ${depth}`} style={{ display: 'flex' }}>
      <path d={d} fill={color} />
    </svg>
  );
}

export function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 24, lineHeight: 1.5, color: PAPER_INK }}>
      <span style={{ color: PAPER_MUTED }}>{label}</span>
      <span style={{ color: tone ?? PAPER_INK, maxWidth: 300, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{value}</span>
    </div>
  );
}

export function Dashed() {
  return <div style={{ display: 'flex', height: 0, borderTop: `2px dashed rgba(26,36,25,0.35)`, margin: '12px 0' }} />;
}
