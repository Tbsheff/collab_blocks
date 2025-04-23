# CollabBlocks – Developer Build Instructions (M1‑Alpha)

*Version 0.1 – April 16 2025*

---

## 0. Scope of This Guide
These instructions walk a **new backend & frontend engineer** through building the **M1‑Alpha** slice of CollabBlocks:
* Presence API (live cursors, avatars, status)  
* Realtime Storage (CRDT core)  
* Basic React SDK hooks  
* Edge WebSocket infrastructure  
* Minimal CI/CD pipeline & Terraform IaC

Key reference docs (canvas):
* *Platform Technical Plan*  
* *Presence API Technical Plan*  
* *Realtime Storage (CRDT) Technical Plan*

---

## 1. Local Environment Setup
| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | **v20.12.0 LTS** | SDK & backend services |
| pnpm | 9.x | Monorepo package manager |
| Go | 1.22 | CLI / misc tooling |
| Docker | 24.x | Local infra via docker‑compose |
| Terraform | 1.8.x | IaC |
| kubectl | 1.30 | K8s chores |
| Tilt | 0.32 | Local dev‑loop |
| Redis | 7.x | Presence stream |
| Postgres | 16 + Citus 12 | OpLog |
| NATS JetStream | 2.10 | Message bus |

```bash
# macOS setup (example)
brew install node@20 go redis postgresql nats-io/nats-tools/nats terraform tiltdev/tap/tilt pnpm
```

---

## 2. Repository Structure
```
collabblocks/
├─ apps/
│  ├─ collab-pod/         # TS backend (uWebSockets)
│  ├─ edge-worker/        # CF Worker Typescript
│  ├─ api-gateway/        # Fastify REST for auth
│  └─ react-sdk/          # SDK package
├─ infra/
│  ├─ terraform/          # AWS + Cloudflare modules
│  └─ k8s/                # Helm charts, manifests
├─ scripts/
│  └─ dev-docker-compose.yml
└─ docs/
   └─ adr/                # Architecture decision records
```
Clone repo:
```bash
git clone git@github.com:yourorg/collabblocks.git && cd collabblocks
pnpm install -r   # bootstrap workspace
```

---

## 3. Spin‑Up Local Dev Stack
```bash
# 3.1 Start docker services (Redis, Postgres+Citus, NATS)
pnpm run dev:infra        # wrapper around docker‑compose -f scripts/dev-docker-compose.yml up

# 3.2 Bootstrap DB
pnpm --filter collab-pod run prisma:migrate  # applies schemas (comments later)

# 3.3 Start backend services via Tilt
 tilt up  # opens web UI (http://localhost:10350)

# 3.4 Run the React example app
pnpm --filter react-sdk run dev
```
Check:
* `localhost:1234/metrics` returns Prometheus metrics from collab‑pod.
* Web app connects, shows your cursor in playground.

---

## 4. Implement Presence API
### 4.1 Edge Worker
* File: `apps/edge-worker/src/presence.ts`  
* Use `@cloudflare/workers-types` + `uwebsockets-ws` polyfill.  
* Implement handshake per Presence plan §4: validate JWT, attach socket to Durable Object.

### 4.2 Durable Object
* File: `apps/edge-worker/src/room_do.ts`  
* Methods: `connect(socket, userPayload)`, `broadcast(diff)`.  
* Persist `primaryPodId` in internal storage KV; update on `health_check_fail`.

### 4.3 Collab Pod PresenceManager
* Location: `apps/collab-pod/src/presence/manager.ts`  
* Implement `applyDiff`, `flushToRedis`, `consumeRedisStream` per plan.

### 4.4 SDK Hooks
* File: `apps/react-sdk/src/presence.ts`  
* Export `createPresenceHooks` returning `useMyPresence`, `useOthers`.  
* Debounce updates via `requestAnimationFrame` (see plan §7).

### 4.5 Tests
```bash
pnpm test -w apps/collab-pod -- presence
```
✓ property‑based tests should pass.

---

## 5. Implement Realtime Storage CRDT Core
### 5.1 CRDT Layer
* Folder: `apps/collab-pod/src/crdt/`  
  * `LiveObject.ts`, `LiveMap.ts`, `LiveList.ts` classes per plan §2.  
  * Use Yjs: create wrappers translating Y events ➜ Protobuf ops.
* Implement **OpBuffer** & **Merge Loop** (plan §4.3).

### 5.2 Edge Protocol
* Extend WS frame enum: `0x02` for Yjs updates (binary).  
* Edge Worker forwards to collab pod gRPC (`MutateStream`).

### 5.3 Persistence
* Setup Prisma model according to plan §4.5.  
* Ensure Citus hash sharding by `room_id`.

### 5.4 SDK Storage Hooks
* `apps/react-sdk/src/storage.ts` – `useStorage(rootSelector)` and `useMutation(fn)` hooking into local Yjs doc.

### 5.5 Snapshot Worker
* Cron in collab‑pod: run every 5 s; serialize & gzip Y.Doc ➜ `local/snapshots` (dev path).

### 5.6 Tests
* Fuzz convergence with 10 parallel node processes applying random ops.

---

## 6. Terraform Bootstrap
* Directory: `infra/terraform/environments/dev`  
* Run `terraform init && terraform apply` to spin up:
  * AWS VPC, EKS, RDS (Citus), Elasticache Redis, S3 buckets.
  * Cloudflare Workers & KV namespaces.
* Outputs should include `KUBECONFIG`, `CF_API_TOKEN`, `JWT_ISSUER_KEY`.

---

## 7. CI/CD Pipeline
1. **GitHub Actions**:  
   * Workflow `ci.yml` – lint, test, build docker images.
   * Workflow `deploy.yml` – push to ECR, update Argo CD image tag.
2. **Argo CD**: ApplicationSet scanning `infra/k8s/*` Helm charts.
3. **Progressive Rollout**: Helm values include `argo-rollouts` canary strategy 5 → 20 → 100 %.

---

## 8. Observability Quick Win
* Add `@opentelemetry/api` + `@opentelemetry/sdk-node` in collab‑pod.  
* Export OTLP to local Tempo container (`http://tempo:4318`).  
* Prometheus job scraping collab‑pod `/metrics` every 15 s (edit `infra/prometheus/prometheus.yml`).

---

## 9. Manual Test Checklist
- [ ] Two browser tabs show each other’s cursors in <200 ms.  
- [ ] Typing in one tab updates Yjs doc in the other within <300 ms.  
- [ ] Redis `XLEN presence-room` grows with diffs then trimmed.  
- [ ] Postgres `ops` table receives batches every ≤5 s.  
- [ ] Telemetry appears in Grafana dashboard.

---

## 10. Commit & PR Guidelines
* Conventional Commits (`feat: presence diff algorithm`, `fix: lru eviction bug`).  
* PR template includes `Tech Plan Ref` field (link to canvas doc section).  
* Require 1 review + green CI before merge.

---

## 11. Next Steps After Alpha
* Comments & Notifications technical tasks (see relevant plans).  
* Harden Redis cluster & NATS JetStream persistence.  
* SOC2 controls kick‑off.

---

> **Need help?** Ping `#collabblocks-dev` Slack or consult the canvas technical plans.

