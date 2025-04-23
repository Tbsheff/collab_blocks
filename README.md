# CollabBlocks

CollabBlocks provides **drop‑in real‑time collaboration infrastructure** — presence, CRDT storage, comments, notifications, AI copilots, and offline sync.

## Project Structure

This monorepo contains the following packages:

- `packages/protocol` - Shared types and protocols
- `apps/collab-pod` - Collaboration server with CRDT engine
- `apps/edge-worker` - Edge WebSocket proxy using Cloudflare Workers
- `apps/react-sdk` - React SDK for client applications
- `apps/demo-web` - Demo web application

## Development

### Prerequisites

- Node.js 20+
- pnpm 10+
- Docker (for running Redis, PostgreSQL, and NATS)

### Setup

1. Clone the repository
```bash
git clone https://github.com/yourusername/collab_blocks.git
cd collab_blocks
```

2. Install dependencies
```bash
pnpm install
```

3. Start the development servers
```bash
# Terminal 1 - Run the collab-pod server
pnpm --filter @collabblocks/collab-pod dev

# Terminal 2 - Run the demo web app
pnpm --filter @collabblocks/demo-web dev
```

4. Open two browser windows to see realtime collaboration:
```
http://localhost:3000
```

## Features (M1 Alpha)

- [x] Presence API (live cursors, avatars)
- [x] Realtime Storage (LiveObject)
- [~] Broadcast channel & threaded comments (backend done, client hooks in progress)
- [ ] Notifications system
- [x] Monitoring dashboard

## License

MIT 