# CollabBlocks – Feature Sprint 1 Build Guide

*Goal:* Turn the Day‑0 scaffold into a functional **MVP with live Presence and basic Realtime Storage** that round‑trips data between two browser tabs.

*Sprint length:* **2 weeks**

---

## 0. Prerequisites

Ensure you completed all Day‑0 bootstrap steps and local services (`postgres`, `redis`, `nats`) are running.

---

## 1. Presence API Implementation

### 1.1 Add Shared Types

```bash
mkdir -p packages/protocol/src
```

`packages/protocol/src/presence.ts`:

```ts
export interface PresenceState {
  cursor?: { x: number; y: number };
  avatar?: string;
  status?: string;
  meta?: Record<string, unknown>;
}
```

Export MsgPack helpers using `@msgpack/msgpack`.

### 1.2 Edge Durable Object (RoomDO)

- Path: `apps/edge-worker/src/room_do.ts`.
- Responsibilities:
  1. On `websocketconnect`, validate JWT (TODO: stub accept all).
  2. Bind to **primary collab‑pod** (hard‑code `http://localhost:8080` for dev).
  3. Relay client diffs (`0x01 presence_diff`) downstream; fan‑out to sockets.
- Use `websocket.accept()` streaming API in Cloudflare Workers.

### 1.3 Collab‑Pod Presence Manager

- Create `apps/collab-pod/src/presence/manager.ts` with:
  - `applyDiff(clientId, diff: PresenceState)`
  - `serializeFullState()` for sync.
  - In‑memory `LRU` (use `lru-cache` pkg) size 1000.
- Expose gRPC service using **tRPC over WebSocket** (simpler for now):
  - `mutatePresence(roomId, diff)`
  - `syncPresence(roomId) -> PresenceState[]`

### 1.4 SDK Hooks

`apps/react-sdk/src/presence.tsx`:

```tsx
import { PresenceState } from '@collabblocks/protocol';
export function useMyPresence() { /* send diff via WS */ }
export function useOthers(selector?: (s: PresenceState) => any) { /* subscribes */ }
```

- Debounce cursor updates `requestAnimationFrame`.

### 1.5 Manual Test

1. `pnpm --filter demo-web dev` (tab 1) & open tab 2.
2. Verify cursor from tab 1 appears in tab 2 within 200 ms.

---

## 2. Realtime Storage (LiveObject only)

*(We’ll add LiveList/Map later; start small.)*

### 2.1 Yjs Setup

```bash
pnpm add yjs @syncedstore/core  # in collab-pod & react-sdk
```

Create wrapper `apps/collab-pod/src/storage/liveObject.ts` that wraps Y.Map.

### 2.2 Edge Protocol

Add WS opcode `0x02 storage_update`. Client serializes **Y.Update** binary (Uint8Array) and sends. Edge Worker forwards as‑is to collab‑pod.

### 2.3 Collab‑Pod Storage Engine

- New folder `src/storage/`:
  - `engine.ts` maintains `Map<roomId, Y.Doc>`.
  - On update received: `Y.applyUpdate(doc, update)` then broadcast `update` to other sockets.
- Persistence deferred—store in memory for MVP.

### 2.4 React SDK Hook

`apps/react-sdk/src/storage.ts`:

```ts
export function useLiveObject<T>(initial: T) { /* returns [state, setState] */ }
```

Implementation: subscribe to Y.Doc events, call `setState`.

### 2.5 Playground Integration

Edit `apps/demo-web/src/App.tsx` to include text area bound to LiveObject:

```tsx
const [doc, setDoc] = useLiveObject<{ text: string }>({ text: '' });
return <textarea value={doc.text} onChange={e => setDoc({ text: e.target.value })} />;
```

Text typed in tab 1 should appear in tab 2 within 300 ms.

---

## 3. Basic JWT Auth Stub

- Create `packages/auth/src/index.ts` exporting `sign(devUser)`, `verify(token)` using `jsonwebtoken` HS256 with hard‑coded secret `DEV_SECRET` from `.envrc`.
- Edge Worker uses `verify` before accepting socket.

---

## 4. NATS & Redis Integration (Optional for MVP)

If time permits:

- Add NATS client to collab‑pod; publish presence diffs to `room.${id}.presence` subject.
- Use Redis `SETEX` for presence last‑seen TTL.

---

## 5. Tests

```bash
pnpm test -r  # runs vitest in all packages
```

- Write at least one test: two Yjs docs exchange update via memory channel converge to same state.

---

## 6. Update CI

- Extend `ci.yml` to run `pnpm test -r`.
- Cache pnpm store with `actions/cache`.

---

## 7. Definition of Done Checklist

-

Merge PR with commit: `feat: presence & liveObject MVP`.

---

## 8. Next Sprint Preview

- Add LiveList/Map types.
- Persist OpLog to Postgres.
- Introduce Redis Streams cross‑pod fan‑out.
- Begin Comments feature groundwork.

