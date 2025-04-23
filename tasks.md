# Tasks for Building CollabBlocks

This checklist breaks down every step needed to build CollabBlocks end‑to‑end. Mark each item when complete.

## 1. Local Environment Setup
- [ ] Install Node.js v20.12.0 LTS
- [ ] Install pnpm v9.x globally
- [ ] Install Go 1.22
- [ ] Install Docker 24.x and Docker Compose
- [ ] Install Redis 7.x
- [ ] Install PostgreSQL 16 + Citus 12
- [ ] Install NATS JetStream 2.10
- [ ] Install Terraform 1.8.x
- [ ] Install Tilt 0.32
- [ ] Install kubectl v1.30
- [ ] Verify each tool's version via CLI



## 3. Spin Up Local Infrastructure Services
- [ ] Review `scripts/dev-docker-compose.yml`
- [ ] Run `pnpm run dev:infra` to start Redis, Postgres + Citus, NATS
- [ ] Confirm Redis, Postgres, NATS are listening on default ports

## 4. Database Schema & Migrations
- [ ] Define Prisma schema for collab-pod (ops, presence, comments)
- [ ] Run `pnpm --filter collab-pod run prisma:migrate`
- [ ] Confirm migrations applied (`prisma studio` or `1SELECT table_name FROM information_schema.tables;1`)

## 5. Edge Worker & JWT Auth Stub
- [ ] Create `packages/auth/src/index.ts`
- [ ] Install `jsonwebtoken`
- [ ] Implement `sign(devUser)` and `verify(token)` with HS256 and `DEV_SECRET`
- [ ] Add `.envrc` or `.env` containing `DEV_SECRET`
- [ ] Add verify(token) call in `apps/edge-worker/src/presence.ts`

## 6. Presence API Implementation
### 6.1 Shared Types
- [ ] Create directory `packages/protocol/src`
- [ ] Create `packages/protocol/src/presence.ts` with `PresenceState` interface
- [ ] Export MsgPack helpers using `@msgpack/msgpack`

### 6.2 Edge Durable Object
- [ ] Open `apps/edge-worker/src/room_do.ts`
- [ ] Implement `websocketconnect` handler with JWT validation stub
- [ ] Implement `connect(socket, userPayload)` method
- [ ] Implement `broadcast(diff)` to fan‑out to connected sockets
- [ ] Hard‑code collab-pod URL to `http://localhost:8080` for dev

### 6.3 Collab-Pod Presence Manager
- [ ] Create file `apps/collab-pod/src/presence/manager.ts`
- [ ] Install `lru-cache`
- [ ] Implement `applyDiff(clientId, diff: PresenceState)`
- [ ] Implement `serializeFullState()` to return full presence array
- [ ] Expose tRPC endpoints: `mutatePresence(roomId, diff)` and `syncPresence(roomId)`

### 6.4 React SDK Hooks
- [ ] Open `apps/react-sdk/src/presence.tsx`
- [ ] Implement `useMyPresence()` sending diffs via WebSocket
- [ ] Implement `useOthers(selector?)` subscribing to others' states
- [ ] Debounce outgoing cursor updates with `requestAnimationFrame`

### 6.5 Testing & Manual Verification
- [ ] Write Vitest unit tests for `applyDiff` and LRU eviction
- [ ] Run `pnpm test -w apps/collab-pod --presence`
- [ ] Start demo: `pnpm --filter demo-web dev` in two tabs
- [ ] Verify cursors sync within 200 ms

## 7. Realtime Storage (LiveObject MVP)
### 7.1 Dependencies
- [ ] Run `pnpm add yjs @syncedstore/core` in `apps/collab-pod` and `apps/react-sdk`

### 7.2 Edge Protocol
- [ ] Define new WS opcode `0x02 storage_update` in `apps/edge-worker/src/protocol.ts`
- [ ] Forward binary Yjs updates from client → collab‑pod

### 7.3 Collab-Pod Storage Engine
- [ ] Create `apps/collab-pod/src/storage/engine.ts`
- [ ] Maintain `Map<roomId, Y.Doc>` in memory
- [ ] On update: `Y.applyUpdate(doc, update)` then broadcast update to local sockets

### 7.4 React SDK Hook
- [ ] Create `apps/react-sdk/src/storage.ts`
- [ ] Implement `useLiveObject<T>(initial: T)` returning `[state, setState]`
- [ ] Subscribe to Yjs document updates and call `setState`

### 7.5 Demo Integration
- [ ] Edit `apps/demo-web/src/App.tsx` to use `useLiveObject<{ text: string }>`
- [ ] Render `<textarea>` bound to `doc.text`
- [ ] Verify text syncs in <300 ms across two tabs

### 7.6 Tests
- [ ] Write a Vitest golden test for two Yjs docs merging via in‑memory channel
- [ ] Confirm deterministic convergence

## 8. Basic CI/CD & Infra
- [ ] Add `ci.yml` in `.github/workflows` to run lint, type checks, and `pnpm test -r`
- [ ] Add caching for `~/.pnpm-store`
- [ ] Add `deploy.yml` to build Docker images and trigger Argo CD
- [ ] Create `infra/terraform/environments/dev` with basic AWS VPC, Redis, Postgres, NATS, S3, and Cloudflare KV
- [ ] Run `terraform init && terraform apply`

## 9. Broadcast & Threaded Comments
- [ ] Define SQL tables in Prisma for `comments` and `comment_reactions`
- [ ] Run Prisma migration for comments
- [ ] Add WS msg types `0x10`–`0x14` in edge protocol
- [ ] Create `apps/collab-pod/src/comments/manager.ts` with CRDT merge and OR‑Set for reactions
- [ ] Expose tRPC hooks: `addComment`, `editComment`, `deleteComment`, `addReaction`, `removeReaction`
- [ ] Implement mention parsing `/@username/` and emit events to NATS `notif.*`
- [ ] Write React hooks in `apps/react-sdk/src/comments.ts`
- [ ] Build UI components: `CommentThread`, `ReactionBar` in demo app
- [ ] Add unit and integration tests for comments and reactions

## 10. Notifications System
- [ ] Define `notification_preferences` and `notifications_inbox` tables in Prisma
- [ ] Run Prisma migration for notifications
- [ ] Implement Notification Worker service consuming `notif.*` JetStream
- [ ] Build Delivery Router to render Handlebars templates
- [ ] Add channel adapters for SES, Slack, Teams, Web Push
- [ ] Create React hooks: `useNotifications()` and `markSeen()` in `apps/react-sdk`
- [ ] Write tests for template rendering, retry logic, and DLQ behavior

## 11. Monitoring Dashboard & DevTools Extension
- [ ] Add OpenTelemetry SDK to collab‑pod and React SDK
- [ ] Configure Prometheus scrape endpoint in collab‑pod
- [ ] Write Grafana dashboard JSON and commit under `infra/monitoring`
- [ ] Implement ClickHouse consumer service for `metrics.ops`
- [ ] Build DevTools Bridge sidecar in `apps/edge-worker` or separate service
- [ ] Create browser extension manifest V3 and React UI panels
- [ ] Publish extension unlisted to Chrome Web Store for internal testing
- [ ] Write E2E tests to validate DevTools panels

## 12. AI Copilot Private Beta
- [ ] Create AI Service (`apps/ai-service`) with SSE `/v1/copilot/chat` endpoint
- [ ] Integrate Vercel AI SDK and provider routing logic
- [ ] Implement Retrieval Layer: fetch last 256 ops, embed via Pinecone
- [ ] Stream tokens to client and convert LLM ops → `mutateStorage`
- [ ] Add UI component in demo app for Copilot chat and slash commands
- [ ] Write unit tests for prompt template rendering and failover

## 13. Version History Private Beta
- [ ] Implement SnapshotWorker in collab‑pod to serialize Y.Doc every 5 s
- [ ] Upload snapshots to S3 and record in `snapshots` table
- [ ] Create diff API service to compute JSON diffs between snapshots
- [ ] Build rollback endpoint merging CRDT ops
- [ ] Add timeline UI in demo app
- [ ] Write performance tests for diff rendering and rollback

## 14. Offline Sync Experimental
- [ ] Register Service Worker in demo app
- [ ] Implement IndexedDB schema for queuing ops per room
- [ ] Hook into reconnect logic to flush queued ops
- [ ] Add UI indicators for offline status and sync progress
- [ ] Write offline conflict resolution tests

## 15. Compliance (SOC 2 T2 & HIPAA)
- [ ] Draft policy documents for SOC 2 and HIPAA controls
- [ ] Implement immutable audit log table in Prisma
- [ ] Configure automated evidence collection via Drata SaaS
- [ ] Run vulnerability scans and pen tests, record results

## 16. SDK Packages & Webhooks
- [ ] Finalize API surface for React, Node, and Webhook gateway
- [ ] Generate Typedoc documentation for each SDK package
- [ ] Configure semantic-release for automatic versioning
- [ ] Build and publish npm packages for each SDK
- [ ] Create example starter apps demonstrating all features
- [ ] Write integration tests for webhook retry and signature validation

---

*All tasks broken down into the smallest actionable items.* 