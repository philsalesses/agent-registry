import { formatUsd, type WireOffer } from 'ans-core';
import { config } from '../config';
import type { AgentRow } from './auth';
import { ownerSegment, toWireOffer, type OfferRow } from './offers';

/**
 * Generated skill.md for offers (docs/DESIGN.md sections 2 Loop B and 7
 * "Contract"): what to send, what comes back, what it costs, and how to call
 * it three ways. Publisher text is already stripped of markup and newlines at
 * publish; it is escaped again here so it can never open a heading, a list or
 * a code fence.
 */

export const RECEIPT_LINE = 'Every call opens and seals a receipt: https://ans-registry.org/skill.md';
const MAX_CURL_BODY = 4000;

/** A fenced block whose fence is longer than any backtick run inside the content. */
function fenced(content: string, lang: string): string {
  const longest = (content.match(/`+/g) ?? []).reduce((m, run) => Math.max(m, run.length), 0);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${content}\n${ticks}`;
}

/** Inline publisher text: no raw angle brackets, and nothing at the start that markdown reads as a block. */
function inline(text: string): string {
  const s = text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\s+/g, ' ').trim();
  return s.replace(/^([#>+*-]|\d+[.)])/, '\\$1');
}

/** Code span for names and values (backticks inside are dropped; names never contain them). */
function code(text: string): string {
  return `\`${text.replace(/`/g, '')}\``;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function feePercent(bps: number = config.feeBps): string {
  return `${bps / 100}%`;
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function toolName(owner: Pick<AgentRow, 'id' | 'handle'>, slug: string): string {
  return `${ownerSegment(owner)}__${slug}`;
}

function h(level: number, text: string): string {
  return `${'#'.repeat(Math.min(6, Math.max(1, level)))} ${text}`;
}

function priceSection(o: WireOffer, level: number): string[] {
  const price = BigInt(o.priceMicros);
  const lines = [h(level, 'Price and credit'), ''];
  if (price === 0n) {
    lines.push('- Price: free (0 USD micros per call). No credit is held.');
    lines.push(`- Fee: the platform fee is ${feePercent()} of the price, taken from the price at release, so a free call costs nothing.`);
  } else {
    lines.push(`- Price: ${formatUsd(price)} per call (${o.priceMicros} USD micros), held in escrow when the call starts.`);
    lines.push(
      o.acceptsSandbox
        ? '- Credit: sandbox or cash. Sandbox is the default when you do not send `creditClass`.'
        : '- Credit: cash only. This offer refuses sandbox credit.',
    );
    lines.push(`- Fee: ${feePercent()} of the price, taken from the price at release. The provider receives the rest; the caller never pays more than the price.`);
    lines.push('- Refunds: a provider error, a timeout, or output that fails the output schema refunds the full price.');
  }
  lines.push(`- Timeout: ${o.timeoutMs} ms, synchronous (the maximum is 120000).`);
  if (o.stats.calls > 0) {
    lines.push(`- Record: ${o.stats.ok} of ${o.stats.calls} calls succeeded${o.stats.p50Ms !== null ? `, p50 ${o.stats.p50Ms} ms` : ''}.`);
  }
  if (o.probeOk !== null && o.probedAt) {
    lines.push(`- Probe ${o.probeOk ? 'passed' : 'failed'} on ${o.probedAt.slice(0, 10)}.`);
  }
  return lines;
}

function sendSection(o: WireOffer, level: number): string[] {
  const example = o.examples[0];
  const lines = [h(level, 'Send'), '', `Input JSON Schema (${o.urls.inputSchema}):`, '', fenced(json(o.inputSchema), 'json')];
  if (example) lines.push('', 'Example input:', '', fenced(json(example.input), 'json'));
  return lines;
}

function getBackSection(o: WireOffer, level: number): string[] {
  const example = o.examples[0];
  const lines = [h(level, 'Get back'), '', `Output JSON Schema (${o.urls.outputSchema}):`, '', fenced(json(o.outputSchema), 'json')];
  if (example) lines.push('', 'Example output:', '', fenced(json(example.output), 'json'));
  return lines;
}

function callSection(o: WireOffer, owner: Pick<AgentRow, 'id' | 'handle'>, level: number): string[] {
  const tool = toolName(owner, o.slug);
  const example = o.examples[0];
  let requestBody = JSON.stringify({ offer: o.name, input: example ? example.input : {} });
  if (requestBody.length > MAX_CURL_BODY) requestBody = JSON.stringify({ offer: o.name, input: 'SEE_SEND_ABOVE' });
  const curl = [
    `curl -X POST ${config.publicApiUrl}/v1/invoke \\`,
    '  -H "Authorization: Bearer ak_..." \\',
    '  -H "Content-Type: application/json" \\',
    '  -H "Idempotency-Key: <unique per call>" \\',
    `  -d ${shellSingleQuote(requestBody)}`,
  ].join('\n');
  return [
    h(level, 'Call it'),
    '',
    h(level + 1, '1. MCP over stdio'),
    '',
    `Add \`npx -y ans-mcp\` to your MCP client, then call the tool ${code(tool)} (or \`ans_invoke\` with \`"offer": "${o.name}"\`).`,
    '',
    fenced(json({ mcpServers: { ans: { command: 'npx', args: ['-y', 'ans-mcp'] } } }), 'json'),
    '',
    h(level + 1, '2. Remote MCP'),
    '',
    `Connect to ${o.urls.mcp} with the header \`Authorization: Bearer ak_...\` (an API key with scope invoke).`,
    '',
    fenced(json({ mcpServers: { [tool]: { url: o.urls.mcp, headers: { Authorization: 'Bearer ak_...' } } } }), 'json'),
    '',
    h(level + 1, '3. HTTP'),
    '',
    fenced(curl, 'bash'),
    '',
    `The response carries \`receiptId\`, \`output\` and \`charged\`. Then accept or reject: \`POST /v1/receipts/<receiptId>/verdict\`.`,
  ];
}

function requiresSection(o: WireOffer, level: number): string[] {
  const r = o.requires;
  if (!r) return [];
  const lines = [h(level, 'Requires'), ''];
  if (r.secrets && r.secrets.length > 0) lines.push(`- Secrets: ${r.secrets.map(code).join(', ')}`);
  if (r.callbackUrl !== undefined) lines.push(`- Callback URL: ${r.callbackUrl ? 'yes' : 'no'}`);
  if (r.notes) lines.push(`- Notes: ${inline(r.notes)}`);
  return lines.length > 2 ? lines : [];
}

function feedsSection(o: WireOffer, level: number): string[] {
  if (o.feeds.length === 0) return [];
  return [
    h(level, 'Feeds'),
    '',
    'The output of this offer is valid input for:',
    '',
    ...o.feeds.map((name) => `- ${code(name)} (${config.publicWebUrl}/offers/${name.replace(/@\d+$/, '')})`),
  ];
}

function offerBody(row: OfferRow, owner: AgentRow, level: number): string[] {
  const o = toWireOffer(row, owner);
  const who = `@${ownerSegment(owner)}`;
  const trust = `trust ${owner.trustScore}, confidence ${Math.round(owner.trustConfidence * 100) / 100}`;
  const status = o.status === 'active' ? '' : ` This offer is ${o.status}: invocations are refused.`;
  const house = owner.isHouse ? ' House offer: run by the registry, free and unranked.' : '';
  return [
    `${inline(o.description || o.title)}`,
    '',
    `Provider: ${who} (${trust}). Offer ${code(o.name)}, id ${code(o.id)}.${house}${status}`,
    '',
    ...priceSection(o, level),
    '',
    ...sendSection(o, level),
    '',
    ...getBackSection(o, level),
    '',
    ...callSection(o, owner, level),
    ...(o.requires ? ['', ...requiresSection(o, level)] : []),
    ...(o.feeds.length > 0 ? ['', ...feedsSection(o, level)] : []),
  ];
}

/** skill.md for one offer. */
export function offerSkillMd(offer: OfferRow, owner: AgentRow): string {
  const o = toWireOffer(offer, owner);
  const lines = [h(1, `${inline(o.title)} (${o.name})`), '', ...offerBody(offer, owner, 2), '', RECEIPT_LINE, ''];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** skill.md listing all of an agent's offers, each with the same sections. */
export function agentSkillMd(agent: AgentRow, offerRows: OfferRow[]): string {
  const who = `@${ownerSegment(agent)}`;
  const lines = [
    h(1, `${inline(agent.name)} (${who}) on ANS`),
    '',
    `Agent ${code(agent.id)}. Trust ${agent.trustScore} (confidence ${Math.round(agent.trustConfidence * 100) / 100}, rank ${Math.round(agent.trustRank * 10) / 10}).${agent.isHouse ? ' House agent: run by the registry, unranked.' : ''}`,
    '',
    offerRows.length === 0
      ? 'No active offers yet.'
      : `${offerRows.length} active offer${offerRows.length === 1 ? '' : 's'}. Each section is the full contract.`,
  ];
  for (const row of offerRows) {
    const o = toWireOffer(row, agent);
    lines.push('', h(2, `${inline(o.title)} (${o.name})`), '', ...offerBody(row, agent, 3));
  }
  lines.push('', RECEIPT_LINE, '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
