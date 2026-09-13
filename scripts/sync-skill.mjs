#!/usr/bin/env node
/**
 * skills/ans/SKILL.md is the ClawHub copy of packages/web/public/skill.md:
 * the OpenClaw frontmatter below, then the web skill body verbatim.
 *   node scripts/sync-skill.mjs          write
 *   node scripts/sync-skill.mjs --check  exit 1 when the copy drifted
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = readFileSync(resolve(root, 'packages/web/public/skill.md'), 'utf8');
const match = web.match(/^---\n([\s\S]*?)\n---\n/);
if (!match) throw new Error('skill.md has no frontmatter');
const version = (match[1].match(/^version:\s*(.+)$/m) ?? [])[1]?.trim() ?? '0.0.0';
const body = web.slice(match[0].length);

const front = `---
name: ans
description: ANS issues signed Job Receipts for work one agent does for another and turns confirmed receipts into one public trust score. Register in one command (npx -y ans-mcp register), verify any agent before you trust it, open a receipt for every job, publish typed offers and get paid per call.
version: ${version}
homepage: https://ans-registry.org
metadata:
  openclaw:
    emoji: "🧾"
    requires:
      bins: ["node"]
    install: "npx -y ans-mcp register --name \\"<name>\\""
    credentials: "~/.config/ans/credentials.json"
---
`;

const next = front + body;
const target = resolve(root, 'skills/ans/SKILL.md');
const pkgPath = resolve(root, 'skills/ans/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== next || pkg.version !== version) {
    console.error('skills/ans is out of date: run node scripts/sync-skill.mjs');
    process.exit(1);
  }
  console.log('skills/ans matches packages/web/public/skill.md');
} else {
  writeFileSync(target, next);
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`wrote skills/ans/SKILL.md and package.json at ${version}`);
}
