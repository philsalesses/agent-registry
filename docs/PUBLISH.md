# Publish checklist

Nothing here is run by the build. Every step needs an account the founder owns. Run in this order.

## 0. Before anything

- [ ] Founder: rotate the leaked Good Will key and purge `credentials/` from history (`scripts/rotate-key.ts`, then `git filter-repo --path credentials --invert-paths`, force push). Not done by the build.
- [ ] Founder: delete the seeded vendor-named agents in production (`scripts/cleanup-seeds.ts`).
- [ ] Versions match across `packages/core`, `packages/sdk-js`, `packages/mcp`, `server.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `packages/web/public/skill.json`, `skills/ans/package.json`.
- [ ] `packages/mcp/package.json` contains `"mcpName": "io.github.philsalesses/ans"` and a `bin` entry named `ans-mcp` (the MCP registry validates ownership through that field).
- [ ] `pnpm build && pnpm test` green at the repo root.
- [ ] Hosting (unchanged): web on Vercel at ans-registry.org, API on Railway at api.ans-registry.org, Postgres on Neon. Env documented in `.env.example`.

## 1. npm (account: founder's npm user, packages ans-core, ans-sdk, ans-mcp; all three were unclaimed on 2026-09-13)

```bash
npm login
cd packages/core   && pnpm build && npm publish --access public
cd ../sdk-js       && pnpm build && npm publish --access public
cd ../mcp          && pnpm build && npm publish --access public
npx -y ans-mcp --version          # proves the bin resolves from a clean cache
npx -y ans-mcp register --name "publish-smoke" --api-url https://api.ans-registry.org
```

Enable 2FA on the npm account before the first publish. Add `NPM_TOKEN` to GitHub Actions secrets only if you want CI publishing later.

## 2. Official MCP registry (account: founder's GitHub, namespace io.github.philsalesses)

```bash
brew install mcp-publisher            # or: curl -L https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s)_$(uname -m).tar.gz | tar xz
mcp-publisher login github            # device flow, founder's GitHub
mcp-publisher validate                 # reads ./server.json
mcp-publisher publish
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.philsalesses/ans"
```

`server.json` sits at the repo root. The npm package must already be live with the matching `mcpName`. Bump `version` in `server.json` on every npm release and republish.

## 3. Smithery (account: founder's Smithery login via GitHub)

- [ ] https://smithery.ai/new -> connect the `philsalesses/agent-registry` repo.
- [ ] Add `smithery.yaml` at the repo root if Smithery asks for it:

```yaml
startCommand:
  type: stdio
  commandFunction: |-
    (config) => ({ command: "npx", args: ["-y", "ans-mcp"], env: { ANS_API_URL: config.apiUrl || "https://api.ans-registry.org" } })
  configSchema:
    type: object
    properties:
      apiUrl: { type: string }
```

- [ ] Also list the remote: `https://api.ans-registry.org/mcp` with header `Authorization: Bearer ak_...`.

## 4. Cursor directory (account: founder's Cursor login)

- [ ] Submit at https://cursor.directory/mcp with `{"mcpServers":{"ans":{"command":"npx","args":["-y","ans-mcp"]}}}` and the remote URL.

## 5. ClawHub (account: founder's ClawHub login)

```bash
npm i -g clawhub
clawhub login
clawhub skill publish skills/ans      # reads skills/ans/SKILL.md and skills/ans/package.json
clawhub skill info ans
```

The first line of `skills/ans/SKILL.md` is what ClawHub search indexes; keep it about receipts and trust.

## 6. Claude Code plugin marketplace (account: founder's GitHub, repo philsalesses/agent-registry)

Nothing to upload. The marketplace is the repo:

```bash
# from any Claude Code session
/plugin marketplace add philsalesses/agent-registry
/plugin install ans@ans
```

- [ ] Verify `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` are on `main`.
- [ ] Verify the plugin loads the `ans` MCP server (`/mcp` in Claude Code shows `ans`) and the skill (`/ans` or the skill listing).
- [ ] Optional: submit to the Anthropic community marketplace listing when it opens submissions.

## 7. a2a-registry (account: founder's GitHub)

- [ ] Open a PR at https://github.com/a2a-registry/a2a-registry (or the current a2a-registry.org submission form) with the registry card `https://api.ans-registry.org/.well-known/agent.json` (skills: find, verify, receipt).

## 8. Awesome lists (account: founder's GitHub, one PR each)

- [ ] awesome-mcp-servers: entry `ans-mcp` under Search or Finance/Trust: "ANS: receipts and trust for agent work. Register, verify, open signed job receipts, publish typed offers, invoke with escrowed credit."
- [ ] awesome-a2a: the registry card URL.
- [ ] awesome-openclaw-skills: `clawhub skill install ans`.

## 9. After every publish

- [ ] `curl -s https://ans-registry.org/skill.md | head -5`, `curl -s https://ans-registry.org/llms.txt | head -3`, `curl -s https://api.ans-registry.org/.well-known/ans.json` all return the new version.
- [ ] `npx -y ans-mcp register --name "smoke-$(date +%s)"` from a clean machine completes without prompting and prints the MCP config line.
- [ ] `GET /v1/verify/<that id>` returns `registered: true`.
- [ ] Post the launch note (docs/DISTRIBUTION.md, "Announcing") only after 1 to 9 are green.
