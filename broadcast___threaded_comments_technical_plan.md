# CollabBlocks – Broadcast & Threaded Comments Technical Plan (v0.1)

*Prepared April 16 2025*

---

## 1. Objective & Definition of Done
Build a **low‑latency broadcast channel** and **rich, threaded comments system** with emoji reactions, @mentions, and real‑time fan‑out. DoD:
* p95 comment fan‑out RTT ≤ 60 ms (NA/EU) for 1 k clients/room.
* Supports threads depth ≤ 5, 1 k comments per room.
* Reactions converge conflict‑free under concurrent updates.
* Mention notifications trigger external channel via Notif Svc ≤ 2 s.

---

## 2. Architecture Overview
```
Edge WS DO ──▶ gRPC stream ──▶ Collab Pod (Comment Mgr) ──▶ NATS `room.*.comments`
                             │                             ▲
                             │                             │
                             └─▶ Postgres `comments`, `reactions` (Citus)
```
* **Broadcast Path**: SDK ➜ Edge DO ➜ Collab Pod ➜ local sockets + NATS fan‑out ➜ other pods ➜ Edge DO ➜ SDKs.
* **Persistence Path**: On ack, Pod persists comment / reaction mutation in Postgres.
* **Notification Hook**: Pod emits `CommentPosted`, `ReactionAdded` events to NATS `notif.*` subject for Notif Svc.

---

## 3. Wire Protocol (Msg Types)
| Msg Type (uint8) | Name | Payload (MsgPack) |
|------------------|------|-------------------|
| `0x10` | `comment_add` | `{cid, parent, body_md, path, ts}` |
| `0x11` | `comment_edit` | `{cid, body_md, ts}` |
| `0x12` | `comment_del` | `{cid, ts}` |
| `0x13` | `reaction_add` | `{cid, emoji, uid, ts}` |
| `0x14` | `reaction_remove` | `{cid, emoji, uid, ts}` |

`cid` is ULID; `path` is array of ancestor ids enabling O(1) thread reconstruction.

---

## 4. Data Model (Postgres — Citus)
```sql
CREATE TABLE comments (
  id        ULID   PRIMARY KEY,
  room_id   BIGINT NOT NULL,
  parent_id ULID NULL,
  path      LTREE  NOT NULL,
  user_id   TEXT   NOT NULL,
  body_md   TEXT   NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
) PARTITION BY HASH (room_id);

CREATE TABLE comment_reactions (
  comment_id ULID   REFERENCES comments(id) ON DELETE CASCADE,
  emoji      TEXT,
  user_id    TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (comment_id, emoji, user_id)
) PARTITION BY HASH (comment_id);

CREATE INDEX idx_comments_room ON comments(room_id);
CREATE INDEX idx_comments_path ON comments USING GIST(path);
```

Path built via `ltree` (`parent.path || id::text`), enabling subtree fetch (`path <@ 'root.*'`).

---

## 5. Concurrency & CRDT Strategy
* **Comment entities** use Last‑Write‑Wins on `updated_at`.
* **Reactions** use **OR‑Set CRDT** (`add`, `remove` pairs) to merge duplicates safely.
* Collab Pod keeps `Map<commentId, Comment>` in memory; reactions as `Map<emoji, Set<userId>>`.

---

## 6. Mention Parsing & Notification
* Regex: `/@([a-zA-Z0-9_]{3,30})/g` over `body_md`.
* For each match → lookup userId via Auth Service cache.
* Emit `mention` sub‑field in `CommentPosted` event to NATS ➜ Notif Svc ➜ email/Slack.

---

## 7. SDK API Design
```ts
const { useComments, addComment, reactToComment } = createCommentsHooks();

// Post a top‑level comment
addComment({ body: "Looks great!" });

// Reply with emoji reaction
reactToComment(cid, "👍");
```
* Comments UI components: `CommentList`, `CommentBubble`, `ReactionBar`.
* Virtualized list (react‑window) for performance.

---

## 8. Collab Pod – Comment Manager
* **Ring Buffer** (512 k) for pending inbound ops.
* Deduplicate reactions by `(cid, emoji, uid)`; ignore if exists.
* Flush to Postgres every 500 ms or 256 ops (bulk COPY via pg‑copy‑stream).
* On `comment_del`, mark row `deleted_at`, broadcast tombstone.

---

## 9. Rate Limits & Abuse Protection
* Per‑user: 5 comments/sec, 10 reactions/sec.  
* Edge DO maintains token bucket in CF KV (expire 60 s).  
* `comment_del` only allowed for author or org admin.

---

## 10. Metrics & SLOs
| Metric | Target |
|--------|--------|
| `comment_fanout_rtt_ms p95` | ≤ 60 ms |
| `comments_write_latency_ms p95` | ≤ 30 ms |
| `reaction_dup_drop_rate` | < 0.5 % |
| `room_comment_count` | alert at 5 k (consider pagination) |

Dashboards in Grafana; alert on RTT burn rate.

---

## 11. Testing Plan
1. **Unit** – ltree path generation, OR‑Set merge.  
2. **Integration** – Create‑reply‑delete sequence across 3 pods.  
3. **Load** – 1 k clients, 50 comments/s, ensure Postgres <70 % CPU.  
4. **Race** – Concurrent reactions on same comment, validate unique set.  
5. **E2E Cypress** – UI threading, mention highlighting, reaction bar updates.

---

## 12. Rollout Steps
1. **Shadow Write** – Persist to comments table but not broadcast to clients.  
2. Internal QA toggles `comments_beta` flag.  
3. Enable for design partners; monitor RTT + write latency.  
4. Rollout by plan tier (Pro → Free).

---

## 13. Future Enhancements
* **Markdown > HTML** sanitization pipeline with syntax highlight.  
* **Thread subscription** – selective WS subscription to reduce fan-out.  
* **Rich emoji picker & custom emoji uploads**.

