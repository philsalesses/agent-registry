import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';

/**
 * The long-form rules, rendered from src/content (synced copies of docs/TRUST.md and
 * docs/MONEY.md) at build time. The markdown's own H1 is replaced by the page title so
 * the headline stays on one or two lines.
 */

export const DOCS = {
  trust: {
    file: 'trust.md',
    title: 'Trust formula',
    description: 'How ANS computes trust from confirmed receipts: the formula, the outcome table and what it costs to fake.',
  },
  money: {
    file: 'money.md',
    title: 'Money and fees',
    description: 'Credit classes, escrow, the 0.5% fee, spend caps, manual payouts and the compliance boundary.',
  },
} as const;

export type DocSlug = keyof typeof DOCS;

export function isDocSlug(s: string): s is DocSlug {
  return Object.prototype.hasOwnProperty.call(DOCS, s);
}

export interface DocHeading {
  id: string;
  text: string;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z0-9#]+;/g, '')
      .replace(/[`*_~]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

function plainText(text: string): string {
  return text
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function loadDoc(slug: DocSlug): { html: string; headings: DocHeading[] } {
  const source = readFileSync(path.join(process.cwd(), 'src', 'content', DOCS[slug].file), 'utf8');
  const headings: DocHeading[] = [];
  const used = new Map<string, number>();

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        if (depth === 1) return '';
        const base = slugify(plainText(text));
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n + 1}`;
        if (depth === 2) headings.push({ id, text: plainText(text) });
        return `<h${depth} id="${escapeAttr(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
  });

  const html = marked.parse(source, { async: false });
  return { html, headings };
}
