# CollabBlocks – Platform Technical Plan (v0.1, *overly descriptive*)

*Prepared April 16 2025*

---

## 1. Engineering Principles
1. **Local‑first latency (<25 ms p95)** – Compute at the network edge whenever possible.  
2. **Deterministic state** – All authoritative data flows through append‑only logs + CRDT merge; no hidden side effects.  
3. **Stateless core, stateful edge** – Horizontal scale by sharding rooms to pods; move stickiness to Cloudflare Durable Objects.  
4. **Infrastructure‑as‑Code** – Terraform governs *everything* (AWS, Cloudflare, Pinecone, Grafana Cloud).  
5. **Security‑by‑default** – End‑to‑end TLS, encrypted secrets, zero‑trust service mesh.

---

## 2. Macro Architecture
```
   Browser/SDK          Edge (Cloudflare)         Core (AWS EKS)              Data Plane
┌────────────┐        ┌────────────────┐       ┌────────────────┐        ┌────────────────┐
│ React App  │──WS──▶│  WS DurableObj │──gRPC▶│  Collab Pods   │──SQL──▶│  Citus Cluster │
│ Node Server│──REST▶│  Auth Gateway  │       │  (uWS, CRDT)   │        │                │
└────────────┘        └────────────────┘       ├────────────────┤        ├────────────────┤
                                              │   Services      │──▶S3──▶│  ObjectStore   │
                                              │ (AI, Notif, …)  │        └────────────────┘
                                              └────────────────┘
```
Edge WS proxies terminate TLS close to users (<50 ms for 95 % of global traffic). Durable Objects maintain room leadership and sticky routing. Collab Pods run Yjs‑powered CRDT merge loops and expose a gRPC interface secured by an mTLS‑enabled service mesh (Linkerd 2).

---

## 3. Tech Stack & Rationale
| Layer | Technology | Reasoning |
|-------|------------|-----------|
| Edge WS | **Cloudflare Workers + Durable Objects** | Global PoP network, sub‑millisecond cold starts, WS support, easy key‑value storage (R2/KV). |
| Core Runtime | **Node.js 20 + TypeScript + uWebSockets.js** | Event‑loop friendly, high WS throughput (>1 M conns per node). |
| Message Bus | **NATS JetStream** | At‑least‑once delivery, stream persistence, consumer−side pull (back‑pressure). |
| CRDT Engine | **Yjs (+ custom LiveBlocks‑style wrappers)** | Proven perf, Awareness protocol, rich‑text integrations. |
| Persistence | **Citus (Postgres 16)** | Horizontally scalable shards, SQL semantics for analytics joins. |
| Snapshots | **Amazon S3 (intelligent‑tier)** | Cheap cold storage, versioned; 99.999999999% durability. |
| Ephemeral State | **Redis Cluster (6 nodes, I‑Type)** | 1 µs P99, TTL for presence; Streams for cross‑pod fan‑out. |
| AI / Vector | **OpenAI GPT‑4o, Pinecone v3** | Best LLM quality, serverless vector db, metadata filtering. |
| Auth | **JWT (ES256) + OAuth 2 + SAML** | Industry standard, fits edge verification. |
| CI/CD | **GitHub Actions + Argo CD** | Declarative GitOps, progressive canary rollouts. |
| Observability | **OpenTelemetry + Tempo + Prometheus + Grafana** | Metrics, logs, traces in one correlated view. |

---

## 4. Component Deep Dive
### 4.1 Edge WebSocket Proxy
* **Connect Flow** – `Upgrade` handshake ➜ JWT validation (public JWK cached in KV) ➜ Determine `roomId` ➜ `fetch` DurableObject (DO) stub ➜ `DO.idFromName(roomId)` ➜ pass socketPair
* **Sticky Routing** – DO maintains `primaryPodId`; periodically health‑checks collab pod via gRPC streaming ping. Fallback rotates to next pod on timeout >3 s.
* **Back‑pressure** – WS becomes *paused* if send buffer >16 KB; DO queues delta in KV (2 min TTL) until drain event.

### 4.2 Collaboration Pods
* **uWS server** on port 9000; single event loop thread, 4 worker threads for JSON encoding/decoding.  
* **Room Map** – `Map<roomId, RoomState>`; each `RoomState` holds:  
  * `yDoc`: Yjs document  
  * `presenceStore`: LRU of client presence  
  * `versionVector`: Uint32Array of 8 counters (siteIDs)  
  * `lastPersistedSeq`: bigint
* **CRDT Merge Loop** – Apply local ops → broadcast to peers via NATS subject `room.{id}.ops` (async) → throttle every 16 ms.
* **Persistence Worker** – consolidates ops to `CompactOp` protobuf, writes batch every 5 s or 1 k ops; uses Citus partition `ops_{hash(roomId) % 128}`.

### 4.3 Presence Service
* **Redis Streams** (`presence-{roomId}`) hold JSON diff messages; each pod has consumer group `{podId}`.  
* Cleanup Cron (edge DO) drops stream & LRU after `lastSeen` >2 min.

### 4.4 Notification Service
* **Subject** `notif.*`; JetStream durable consumer with *maxAckPending=10k*.  
* SES adapter uses *BulkTemplatedEmail*; Slack adapter uses *chat.postMessage*.  
* DLQ captured into SQS Fifo; retries (exponential, max 5).  
* Rate‑limit per user to 20 msgs/min (Redis *token bucket*).

### 4.5 AI Copilot Service
* **Inference Flow** – Webhook `/v1/copilot/chat` → fetch last 256 ops → build context window → stream completions via SSE to client.  
* Embedding job ingests snapshot every 10 min to Pinecone; upsert meta `roomId`, `blockId`.  
* Token guardrails: track usage via Redis `INCRBYFLOAT` per org/day.

### 4.6 Version History Service
* Tail Postgres WAL (logical replication slot) -> decode `LiveOp` protobuf -> group by `roomId` -> diff algorithm (Myers) for text, path‑based for JSON.
* Snapshot frequency 5 s rolling; store `manifest.json` + `snapshot.bin` in S3 `s3://snapshots/{roomId}/{ts}`.

### 4.7 DevTools Bridge
* Sidecar in each collab pod exposes `/inspect?roomId={id}` (mTLS) that streams `PresenceState` + Yjs update pushes to browser extension.

### 4.8 Analytics Pipeline
* **Prometheus** scrapes `/metrics` every 15 s; push to **Grafana Cloud** remote‑write.  
* **Tempo** receives OTLP traces; logs forwarded via Fluent Bit to Loki.
* **ClickHouse** consumer from JetStream `metrics.ops`; aggregates conn counts for billing.

---

## 5. Data Models & Schemas
### 5.1 Postgres – `ops` table (partitioned)
```sql
CREATE TABLE ops_
(
    room_id   BIGINT NOT NULL,
    seq       BIGINT NOT NULL,
    site_id   INT    NOT NULL,
    ts        TIMESTAMPTZ DEFAULT now(),
    op_bin    BYTEA  NOT NULL,
    PRIMARY KEY (room_id, seq)
) PARTITION BY HASH (room_id);
```
### 5.2 Redis Presence Value
```json
{
  "u": "user123",
  "c": { "x": 0.5, "y": 0.8 },
  "s": "editing",
  "t": 1713260800  // epoch seconds
}
```

---

## 6. DevOps & CI/CD Pipeline
1. **PR Checks** – ESLint, Prettier, type‑check, Vitest, Jest, 10 parallel matrix.  
2. **Docker Build** – Multi‑stage, `--platform=linux/amd64`, SLSA provenance.  
3. **Helm Charts** – One per service; `values-prod.yaml` via Argo CD *ApplicationSet*.  
4. **Progressive Delivery** – Argo Rollouts; 5 % canary, metrics guard (`latency_p95` < +20 %), auto‑promote.  
5. **Infra Drift** – Terraform Cloud with Sentinel policy gates.

---

## 7. Observability & SLOs
| Signal | SLI | SLO |
|--------|-----|-----|
| Presence RTT | p95 RTT | ≤ 40 ms (NA/EU) |
| Ops Merge Latency | 99th < 100 ms | ≥ 99 % |
| Uptime | Monthly availability | ≥ 99.95 % (Pro) |
| Error Rate | 5xx per minute | < 0.1 % |

Alerts powered by Grafana OnCall; paging only if error budget burn > 2 % hr.

---

## 8. Security & Compliance
* **Data at Rest** – AES‑256 via AWS KMS key; S3 buckets private, versioning ON, MFA‑Delete.  
* **Secrets** – SealedSecrets (Bitnami) + SOPS (age) in Git; decoded by Argo CD.  
* **IAM** – Least privilege; pods assume roles via IRSA.  
* **Audit Log** – WORM S3 bucket `s3://audit-logs`; CloudTrail events forwarded.  
* SOC 2 evidence collection automated via Drata.

---

## 9. Capacity & Cost Modeling
* **Baseline**: 3 × c6g.large pods per AZ × 3 AZ = 9 pods (~\$600/mo); 2 × t3.medium Redis (~\$120/mo); Citus: 3 × r6g.large primaries (~\$800/mo).  
* **P50 cost / active connection**: \$0.0009/hr (infra) + \$0.0002 (Cloudflare); scales linearly until 300 k conns then add shard.

---

## 10. Failure Modes & Resilience
| Failure | Mitigation |
|---------|-----------|
| Pod crash | K8s restart; client reconnect via edge DO. |
| Redis partition | Presence degraded; CRDT/storage unaffected. |
| NATS outage | Collab pods buffer ops in memory (1 min) & edge KV (durable). |
| Postgres primary failover | Patroni auto‑promotes standby, pods retry. |
| Cloudflare PoP down | Anycast reroutes to nearest healthy region. |

---

## 11. Test Strategy
1. **Unit** – CRDT merge invariants (property‑based tests).  
2. **Integration** – gRPC → Postgres round‑trip; WS fuzz (Artillery).  
3. **Load** – 100 k conns, 500 ops/s, soak 24 h.  
4. **Chaos** – Kill pods, introduce 5 % packet loss; verify SLOs.  
5. **Security** – Dependency scanning (Snyk), OWASP ZAP, annual pen‑test.

---

## 12. Rollout Plan
1. **Shadow Traffic** – Duplicate 5 % ops from prod to new cluster; validate convergence.  
2. **Pilot** – Select 5 design partners (signed DPA).  
3. **Gradual GA** – 10 %, 25 %, 50 %, 100 % orgs over 4 weeks; SLO burn checks.  
4. **Enterprise Tier** – Dedicated VPC peering & regional data residency after GA.

---

> **Next Steps** – Finalize Detailed Schemas (Appendix A), produce Terraform module specs, schedule capacity testing window by May 15 2025.

