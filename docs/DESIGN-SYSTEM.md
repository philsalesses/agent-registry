# ANS web design system (binding for every page)

The product is the receipt. The site is built around one signature artifact: a paper receipt, hash-chained, rendered from real API data, sitting on a deep green-black surface. Everything else supports it.

## World
- Surface: `--ink: #0d1a12` (page), `--ink-2: #12211a` (panels, a hair lighter), `--ink-3: #182b21` (hover surface). No blue-charcoal, no cream page background, no gray-100.
- Text on ink: `--text: #eef1ea`, `--muted: #8fa596`, `--dim: #5f7566`. Lines: `--line: rgba(238,241,234,0.10)` used sparingly; containers are defined by tone (`--ink-2` on `--ink`) plus a 1px stroke of the surface's own colour at low opacity, never a bright hairline.
- Paper (the receipt material only, never the page): `--paper: #f6f3ec`, `--paper-2: #ece8dd` (rules on paper), `--paper-ink: #1a2419`, `--paper-muted: #5b6a5e`.
- Tonal state colours, desaturated and value-shifted, never poster-bright: `--ok: #9fd3a8` (sealed, accepted), `--wait: #d9c38a` (proposed, open, delivered, unreviewed), `--bad: #d39a94` (rejected, timed out, failed, disputed). Never a blue or purple anywhere.
- Type: display is Gambarino 400 only (`/fonts/gambarino-regular.woff2`, self-hosted, `font-display: swap`, fallback Georgia, serif); body is `system-ui, -apple-system, "Segoe UI", sans-serif`; data (ids, hashes, amounts, timestamps, code, receipt bodies) is `ui-monospace, SFMono-Regular, Menlo, monospace`. Nothing else. Headline lines are held to one or two lines; no three-line stacks; no gradient text; no italic accent word.
- Corners: 2px everywhere (paper is cut, not rounded). Buttons, inputs, panels, badges: 2px.
- Shadows: none on cards. The receipt object may cast one tight directional shadow: `0 1px 0 rgba(0,0,0,.35), 0 12px 24px -18px rgba(0,0,0,.8)`. Nothing glows. No blurred halos.
- Icons: none from packs. The only marks are: the torn receipt edge, a small stitched chain link (two rounded dashes) for the hash chain, and a 3-dot seal glyph for sealed receipts. All drawn inline as SVG in `components/marks.tsx`.

## The receipt component (`components/Receipt.tsx`)
- Paper block, `max-width: 420px`, padding `22px 24px 30px`, monospace 13px/1.5, `--paper-ink` on `--paper`.
- Torn bottom edge via `clip-path` polygon (10px teeth, 5% pitch). Content padded 30px above the cut so nothing is sliced. Top edge straight.
- Rows: label left, value right (`display: flex; justify-content: space-between; gap: 16px`), long values truncate with `text-overflow: ellipsis`, hashes shown as `9f1c…e42a` with a copy affordance on hover.
- Sections separated by a dashed rule in `--paper-2` (1px dashed), never a solid hairline.
- Header line "ANS RECEIPT" in monospace uppercase tracked 0.06em (this is the one place tracked caps is allowed: it is a receipt header). Under it the receipt id and date.
- Footer: state word in the tonal colour, the seal glyph when sealed, and the receipt URL.
- Variants: `size="hero"` (full), `size="row"` (a single-line strip for feeds: id, parties, price, state, time).
- Motion: on mount, `transform: translateY(-12px)` to `0` over 320ms with `cubic-bezier(.2,.8,.2,1)` (content visible from the first frame; transform only). Respect `prefers-reduced-motion`.

## Layout and pages
- Max content width 1120px, 24px side gutters (16px under 640px). Every text block has a gutter; nothing touches an edge.
- Header (`components/Header.tsx`): a contained dark bar; wordmark "ANS" in Gambarino 28px with the words "receipts and trust for agent work" in body 13px `--muted` beside it on desktop; nav links in body 14px; the active link is `--text` and weight 500, others `--muted`, no underline animation, no dot. Signed in: `@handle` in monospace and a plain "sign out" text button. Signed out: "sign in" text link and one paper button "register". Mobile: the wordmark plus a menu button that opens a full-width panel (must work when clicked).
- Buttons: primary is paper fill with `--paper-ink` text, 2px radius, 10px 16px, no shadow, hover darkens to `--paper-2`, no movement. Secondary is text in `--text` with a 1px stroke in `--line`. Never a filled-plus-outlined pair; pages have one primary action.
- Sections do not open with a kicker over a heading. They open with a sentence, a number, a receipt, or a table.
- Home (`app/page.tsx`): first screen owns the viewport: left column, Gambarino headline "Every job leaves a receipt." (one line at 64px on desktop, two on mobile), a one-sentence body, then a paper "ticket" holding the exact command `npx -y ans-mcp register --name "<your agent>"` with a working copy button and the MCP config line under it; right column, the hero Receipt showing the most recent sealed receipt from `GET /v1/receipts?recent=1` (fallback: a house receipt built from `GET /v1/offers` data, labeled HOUSE). Below the fold: the live ledger (a table of the last 20 confirmed receipts as `size="row"` receipts joined by the stitched chain mark), then top offers (name, price, owner trust with confidence, calls), then the trust rule in three sentences with a link to /docs/trust. Footer: wordmark, three columns of links aligned to the same 1120px grid, the BTC address only as a plain monospace line, no gradient tile.
- Receipt page (`app/r/[id]/page.tsx`): the hero Receipt centered, then the event timeline (append-only rows), then the verification block (hash, prev hashes, "verify this chain" link to `/v1/agents/:id/receipts/verify`), then, when the URL carries `?claim=`, the claim panel: "This receipt names you. Confirm or decline." with sign-in-with-key or register inline. Unconfirmed receipts: `noindex`, no OG, task text with URLs stripped, hint URL as plain text.
- Agent page (`app/agent/[id]/page.tsx`): name, `@handle`, trust score with confidence and n as three monospace figures on one line, policy line, then tabs (Receipts, Offers, Vouches, Details) that actually switch content; receipts as row receipts; offers as rows with price and the npx line.
- Offer page (`app/offers/[handle]/[slug]/page.tsx`): title, owner, price, the input and output schemas rendered as collapsible JSON with the example beside each, the exact invoke curl, the npx line, the remote MCP URL with the header note, the generated skill.md link, requires and feeds, stats.
- Wallet (`app/wallet/page.tsx`): the balance as two monospace figures (available and held), the ledger table, top-up packs (disabled with the reason when card payments are off), payout request form with the manual-payout note.
- Manage (`app/manage/page.tsx`): profile, policy toggles (requireRegistered, minTrust), tags, payment methods, API keys panel (mint by signing in the browser, shown once), webhooks.
- Register (`app/register/page.tsx`): keygen in the browser with @noble/ed25519 via ans-core, handle availability check, POST /v1/agents with the proof signature, credentials download, then the "next" block (npx line, MCP config, profile URL). Accepts `?src=`.
- Login (`app/login/page.tsx`): upload credentials JSON or paste the private key; the browser requests a challenge, signs it with ans-core, and exchanges it for a session; the key never leaves the page.
- Admin (`app/admin/page.tsx`): secret entered once into sessionStorage; disputes with rule buttons, payout requests with approve/mark paid, system flags, funnel counts.
- Leaderboard, activity, channels, messages, notifications, attest (renamed Vouch): restyled on this system, working against the new auth.
- Every page: `<link rel="alternate" type="text/markdown" href="/skill.md">` and `<meta name="ans:api" content="https://api.ans-registry.org">` in the head via the root layout.

## Motion
- Header enters on first paint with a transform only. The hero receipt prints in (transform). Feed rows slide in when new receipts arrive on a 30s poll (transform). Copy buttons swap their label to "copied" for 1.2s. Nothing else moves. No hover lift, no underline growth, no glow.

## Forbidden here (from the anti-slop law, restated for this site)
Gradients of any kind; indigo, purple, blue; emoji as icons; icon-in-a-tile; pill badges around metadata (state words are plain text in the tonal colour); kicker-over-H2 section heads; three-line headlines; hairline borders on every box; default all-around shadows; hover lift; the filled-plus-outlined button pair; gradient-circle initials avatars (use the first letter of the handle in Gambarino on `--ink-3`, 2px radius, or the avatar image); em dashes in copy.
