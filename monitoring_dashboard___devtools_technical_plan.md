# CollabBlocks – Monitoring Dashboard & DevTools Technical Plan (v0.1)

*Prepared April 16 2025*

---

## 1. Objective & Definition of Done
Provide:
1. **Real‑time Monitoring Dashboard** for org admins—active connections, ops/s, storage size, latency, error rates—with 1‑minute granularity.
2. **Browser DevTools Extension** (Chrome/Edge) that lets developers inspect Presence, Storage diffs, and WS traffic live.

**DoD:**
* Dashboard widgets refresh ≤ 5 s; historical data retained 30 days.
* DevTools extension connects in <200 ms, shows live Presence & Storage for current room.
* All critical paths instrumented with OTLP traces, metrics, logs.

---

## 2. Monitoring Architecture Overview
```
      Collab Pods ──/metrics──▶ Prometheus ──remote‑write──▶ Grafana Cloud
            │                         │                     ▲
            │ OTLP                    │                     │
            ▼                         │                     │
          Tempo  ◀─────── OTLP ───────┘               Grafana UI
            │                                           (embedded iframe in SaaS)
            ▼
          Loki  ◀─────── logs (Fluent Bit)─────────────┘

ClickHouse  ◀── JetStream (metrics.ops) ── Materialized View (billing & dashboard org slice)
```
* **Prometheus** scrapes every 15 s; federation pod aggregates by org label.
* **Tempo** ingests distributed traces; **Grafana** dashboards query Tempo + Prom for exemplars.
* **Loki** stores structured JSON logs; correlated via trace ID.
* **ClickHouse** stores high‑cardinality metrics (per‑room ops) via JetStream consumer.
* SaaS front‑end embeds Grafana iframe (signed URL) for org‑scoped views.

---

## 3. Metrics Taxonomy
| Category | Metric Name | Labels | Description |
|----------|-------------|--------|-------------|
| Connections | `collab_active_connections` | `org, room_id` | Current WS conns |
| Ops | `crdt_ops_total` (counter) | `org, room_id, type` | Total ops applied |
| Latency | `presence_rtt_ms`, `storage_op_rtt_ms` (histogram) | `org` | p50/95/99 latency |
| Errors | `ws_errors_total` | `org, code` | WS error codes |
| Infra | `cpu_usage`, `mem_usage` | `pod` | Pod resource usage |

All SDKs emit **RTT spans** with `traceparent` header; sampled 10 %.

---

## 4. Grafana Dashboard Specs
### 4.1 Org Admin Dashboard
* **Connections Heatmap** – p95 over 24 h.
* **Ops/sec Line** – stacked by room.
* **Latency Histogram** – selectable bucket zoom.
* **Error Rate Panel** – 5xx, WS closes.
* **Storage Bytes Gauge** – current + quota.

### 4.2 SRE Internal Dashboard
* Pod CPU/Memory, GC stalls.
* NATS JetStream lag.
* Postgres write latency.
* Alert list component.

Dashboards stored as JSON in Git; provisioned via Grafana API.

---

## 5. Alerting & SLO Policies
| SLO | Alert Trigger | Pager Duty Policy |
|-----|---------------|-------------------|
| Uptime 99.95 % | uptime burn >2 % over 1 h | Sev‑1 |
| Presence RTT p95 ≤ 40 ms | rolling 5 m p95 > 60 ms | Sev‑2 |
| Error Rate <0.1 % | 5 m >0.5 % | Sev‑2 |
| Ops Lag <200 ops | OpLog delay >500 | Sev‑3 |

Grafana OnCall routes alerts; Slack for Sev‑3, phone for Sev‑1/2.

---

## 6. DevTools Extension Architecture
```
Browser Extension ↔ (WebSocket w/ JWT) ↔ DevTools Bridge Sidecar ↔ Collab Pod Memory
```
* **Manifest V3**; panels: *CollabBlocks*, *Storage*, *Presence*, *Network*.
* Extension injects `window.__COLLABHOOK__` script to capture SDK events.
* Opens secure WS to `/inspect?roomId=...&token=...` signed by Edge DO (short‑lived JWT 5 min, org‑admin scope).
* Bridge streams:
  * **PresenceState** patch events.
  * **Yjs Update Diffs** (binary -> JSON summary).
  * **Metrics** counters (ops/s) every 1 s.
* UI renders:
  * Live cursors overlay.
  * CRDT tree visualizer (react‑flow).
  * WS raw traffic log.

---

## 7. Security Considerations
* **Org‑Scoped API Keys** for Grafana signed URLs (X‑Sig HMAC, 15 min TTL).
* DevTools token bound to user session; Pod validates via mTLS & audience claim.
* No personal data in traces; redact user names.

---

## 8. Implementation Tasks
1. **Instrumentation** – Add OTLP exporter to SDK & Backend (OpenTelemetry JS & Go).  
2. **Prom Setup** – Helm chart, federation config, remote‑write creds.  
3. **ClickHouse Consumer** – Rust service consuming JetStream `metrics.ops`.  
4. **Grafana Dash JSON** – author in staging, export to Git.  
5. **Iframe Embed** – Signed URL generator (`/api/grafana/signed_url`).  
6. **DevTools Bridge Sidecar** – gRPC server -> WS relay (uWebSockets).  
7. **Extension UI** – React + Tailwind, vite build.  
8. **Chrome Store Publishing** – Brand assets, privacy policy.

---

## 9. Metrics & Acceptance Criteria
| KPI | Target |
|-----|--------|
| Dashboard reload latency | ≤ 5 s |
| DevTools connect time | < 200 ms |
| P95 inspection diff latency | ≤ 50 ms |
| Trace sample ratio | 10 % ± 1 % |

---

## 10. Testing Plan
* **Unit** – Signed URL HMAC, trace context propagation.  
* **Integration** – Prometheus remote‑write to Grafana Cloud sandbox; Tempo span linking.  
* **Load** – 100 k conn metrics burst; iframe refresh stress.  
* **Extension E2E** – Puppeteer open DevTools, assert CRDT tree renders.  
* **Security** – Validate token expiry revokes stream; audit CSP headers.

---

## 11. Rollout Strategy
1. **Internal SRE Beta** – Enable Dashboards only.  
2. Design partners get iframe access.  
3. Release DevTools extension to Chrome Web Store unlisted; share link.  
4. Public listing + Docs update.

---

## 12. Future Enhancements
* **User‑configurable alerts** (webhooks).  
* **Mobile Grafana embed** responsive.  
* **Replay mode** – time‑travel CRDT inspector.

