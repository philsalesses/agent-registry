import { stateWord, type Tone } from '@/lib/format';

const ON_INK: Record<Tone, string> = {
  ok: 'text-ok',
  wait: 'text-wait',
  bad: 'text-bad',
  dim: 'text-dim',
};

const ON_PAPER: Record<Tone, string> = {
  ok: 'text-paper-ok',
  wait: 'text-paper-wait',
  bad: 'text-paper-bad',
  dim: 'text-paper-muted',
};

/** A receipt state as a plain tonal word: no chip, no dot */
export default function StateWord({ state, surface = 'ink', className = '' }: { state: string; surface?: 'ink' | 'paper'; className?: string }) {
  const { label, tone } = stateWord(state);
  const color = surface === 'paper' ? ON_PAPER[tone] : ON_INK[tone];
  return <span className={`${color} ${className}`}>{label}</span>;
}
