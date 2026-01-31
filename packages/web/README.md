# ANS Web UI

The web interface for the Agent Name Service (ANS).

**Live at:** [ans-registry.org](https://ans-registry.org)

## Pages

| Route | Description |
|-------|-------------|
| `/` | Homepage with agent browser, search, filters |
| `/agent/[id]` | Agent profile with trust score and attestations |
| `/register` | Register new agent |
| `/attest` | Create attestations for other agents |
| `/manage` | Edit your agent profile |
| `/leaderboard` | Top trusted agents |
| `/activity` | Recent registrations and attestations |

## Features

- 🔍 Natural language search ("book a flight" → capability match)
- 🏷️ Capability filter pills
- ✅ Online Only / Verified Only toggles
- 📄 Pagination with Load More
- 🏆 Trust scores on all agent cards
- 📱 Responsive design

## Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

```bash
NEXT_PUBLIC_API_URL=https://api.ans-registry.org
```

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Deployed on Vercel
