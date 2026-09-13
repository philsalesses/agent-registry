/**
 * Embeddable SVG marks in the ANS material: paper slips with a torn edge.
 * They sit in READMEs, pull requests and deliverables, on light and dark pages alike.
 */

const PAPER = '#f6f3ec';
const INK = '#1a2419';
const MUTED = '#5b6a5e';
const OK = '#2e6a3c';
const WAIT = '#7a5d12';
const BAD = '#8e3b33';
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Monospace width estimate: 0.6em per character */
function monoWidth(text: string, size: number): number {
  return Math.ceil(text.length * size * 0.6);
}

/** Zigzag along the bottom edge of a slip, as one path */
function tornBottom(width: number, top: number, tooth = 8, depth = 4): string {
  let d = `M0 0 H${width} V${top}`;
  const teeth = Math.ceil(width / tooth);
  for (let i = teeth; i >= 0; i--) {
    const x = Math.min(i * tooth, width);
    d += ` L${x} ${top} L${Math.max(x - tooth / 2, 0)} ${top + depth}`;
  }
  return `${d} L0 ${top} Z`;
}

/** Zigzag along the right edge of a strip */
function tornRight(width: number, height: number, tooth = 8, depth = 4): string {
  let d = `M0 0 H${width - depth}`;
  const teeth = Math.ceil(height / tooth);
  for (let i = 0; i < teeth; i++) {
    const y = i * tooth;
    d += ` L${width} ${Math.min(y + tooth / 2, height)} L${width - depth} ${Math.min(y + tooth, height)}`;
  }
  return `${d} V${height} H0 Z`;
}

export function trustTone(score: number, confidence: number): string {
  if (confidence < 0.05) return MUTED;
  if (score >= 70) return OK;
  if (score >= 45) return WAIT;
  return BAD;
}

export interface AgentBadgeInput {
  name: string;
  handle: string | null;
  score: number;
  confidence: number;
  confirmed: number;
  isHouse?: boolean;
}

/** The agent record slip (style=badge), 248 x 88 */
export function agentRecordSvg(a: AgentBadgeInput): string {
  const width = 248;
  const body = 80;
  const who = escapeXml(a.handle ? `@${a.handle}` : a.name);
  const conf = a.confidence.toFixed(2);
  const receipts = `${a.confirmed} confirmed receipt${a.confirmed === 1 ? '' : 's'}`;
  const title = a.isHouse ? `${who}: ANS house agent, unranked` : `${who}: trust ${a.score} at confidence ${conf}, ${receipts}`;
  const score = a.isHouse ? 'house' : String(a.score);
  const scoreSize = a.isHouse ? 18 : 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${body + 4}" viewBox="0 0 ${width} ${body + 4}" role="img" aria-label="${title}">
  <title>${title}</title>
  <path d="${tornBottom(width, body)}" fill="${PAPER}"/>
  <text x="14" y="20" font-family="${MONO}" font-size="10" font-weight="700" letter-spacing="1.2" fill="${INK}">ANS RECORD</text>
  <text x="${width - 14}" y="20" font-family="${MONO}" font-size="11" fill="${MUTED}" text-anchor="end">${who}</text>
  <path d="M14 29 H${width - 14}" stroke="${INK}" stroke-opacity="0.35" stroke-dasharray="3 3"/>
  <text x="14" y="${a.isHouse ? 58 : 62}" font-family="${MONO}" font-size="${scoreSize}" font-weight="600" fill="${a.isHouse ? MUTED : trustTone(a.score, a.confidence)}">${score}</text>
  <text x="${a.isHouse ? 84 : 70}" y="49" font-family="${MONO}" font-size="11" fill="${MUTED}">${a.isHouse ? 'unranked' : `trust · confidence ${conf}`}</text>
  <text x="${a.isHouse ? 84 : 70}" y="65" font-family="${MONO}" font-size="11" fill="${INK}">${receipts}</text>
</svg>`;
}

/** The flat one-line badge (style=flat), shields-sized */
export function agentFlatSvg(a: AgentBadgeInput, square = false): string {
  const label = escapeXml(a.handle ? `@${a.handle}` : a.name);
  const value = a.isHouse ? 'house' : `trust ${a.score} · ${a.confidence.toFixed(2)}`;
  const lw = monoWidth(label, 11) + 16;
  const vw = monoWidth(value, 11) + 16;
  const w = lw + vw;
  const r = square ? 0 : 2;
  const title = `${label}: ${value}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${title}">
  <title>${title}</title>
  <clipPath id="c"><rect width="${w}" height="20" rx="${r}"/></clipPath>
  <g clip-path="url(#c)">
    <rect width="${lw}" height="20" fill="#12211a"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${PAPER}"/>
  </g>
  <g font-family="${MONO}" font-size="11">
    <text x="${lw / 2}" y="14" fill="#eef1ea" text-anchor="middle">${label}</text>
    <text x="${lw + vw / 2}" y="14" fill="${a.isHouse ? MUTED : trustTone(a.score, a.confidence)}" text-anchor="middle">${value}</text>
  </g>
</svg>`;
}

export interface ReceiptBadgeInput {
  id: string;
  provider: string;
  client: string;
  state: string;
  stateLabel: string;
  price: string;
}

function stateTone(state: string): string {
  if (['accepted', 'resolved_provider'].includes(state)) return OK;
  if (['rejected', 'resolved_client', 'timed_out', 'failed', 'output_invalid'].includes(state)) return BAD;
  if (['cancelled_client', 'cancelled_provider', 'declined', 'expired'].includes(state)) return MUTED;
  return WAIT;
}

/** A torn receipt strip for deliverables: "ANS RECEIPT rc_x / @provider for @client · price · state" */
export function receiptStripSvg(r: ReceiptBadgeInput): string {
  const line = `${r.provider} for ${r.client} · ${r.price}`;
  const head = `ANS RECEIPT  ${r.id}`;
  const textW = Math.max(monoWidth(line, 11) + 12 + monoWidth(r.stateLabel, 11), monoWidth(head, 10) + 14);
  const width = Math.min(Math.max(textW + 36, 220), 560);
  const height = 44;
  const title = escapeXml(`ANS receipt ${r.id}: ${line}, ${r.stateLabel}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <title>${title}</title>
  <path d="${tornRight(width, height)}" fill="${PAPER}"/>
  <text x="12" y="17" font-family="${MONO}" font-size="10" font-weight="700" letter-spacing="1" fill="${INK}">ANS RECEIPT <tspan font-weight="400" letter-spacing="0" fill="${MUTED}">${escapeXml(r.id)}</tspan></text>
  <text x="12" y="34" font-family="${MONO}" font-size="11" fill="${INK}">${escapeXml(line)} <tspan fill="${stateTone(r.state)}">${escapeXml(r.stateLabel)}</tspan></text>
</svg>`;
}

/** Shown in place of a receipt that is not public (unconfirmed or missing) */
export function receiptMissingSvg(id: string): string {
  const text = `ANS receipt ${id.slice(0, 32)} is not public`;
  const width = monoWidth(text, 11) + 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" role="img" aria-label="${escapeXml(text)}">
  <title>${escapeXml(text)}</title>
  <path d="${tornRight(width, 28)}" fill="${PAPER}"/>
  <text x="12" y="18" font-family="${MONO}" font-size="11" fill="${MUTED}">${escapeXml(text)}</text>
</svg>`;
}
