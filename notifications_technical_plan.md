# CollabBlocks – Notifications Technical Plan (v0.1)

*Prepared April 16 2025*

---

## 1. Objective & Definition of Done
Ship a **multi‑channel notifications system** that fans out real‑time events to:
* **In‑app inbox** (React component).
* **Email** via AWS SES.
* **Slack** & **Microsoft Teams** via incoming webhooks.
* **Web Push** (VAPID, service‑worker based).

**Definition of Done (DoD)**
* 99th percentile external delivery ≤ 2 s from event emission.
* At‑least‑once delivery with retry & DLQ (<0.1 % undelivered after retries).
* User‑level preferences stored and enforced (opt‑in/opt‑out per channel & event type).
* Free tier: 10 k notif events/month/org; hard‑limit enforced.

---

## 2. Architecture Overview
```
               ┌──────────────────────────────────────────┐
               │               NATS JetStream            │
               │ subject: notif.* (persistent stream)    │
               └──────────────┬──────────┬───────────────┘
                              │          │ durable consumers
                              │          │
          ┌───────────────────▼───┐  ┌───▼──────────────────┐
          │ Notification Worker  │  │   Quota & Metrics    │
          │ (Go, concurrency 64) │  │  (Rust ClickHouse)   │
          └───────┬──────────────┘  └──────────┬───────────┘
                  │                           │
        ┌─────────▼─────────┐      ┌─────────▼─────────┐
        │  Delivery Router  │      │ Preferences Cache │
        │ (determine channel│      └───────────────────┘
        │ + template)       │                ▲ Redis TTL 60 s
        └───────┬───────────┘                │
        │SES    │Slack    │Teams   │WebPush  │Postgres
┌───────▼───┐┌──▼──────┐┌──▼──────┐┌──▼──────┐┌──▼─────────┐
│ SES API   ││ Slack   ││ Teams   ││ VAPID   ││  user_prefs│
│ bulk email││ webhook ││ webhook ││ send    ││  notif     │
└───────────┘└──────────┘└─────────┘└─────────┘└────────────┘
```
*All outbound adapters emit **DeliveryReceipt** events back to NATS for observability & retries.*

---

## 3. Event Contract
### 3.1 `notif.Event` (published by product services)
| Field | Type | Description |
|-------|------|-------------|
| `id` | ULID | unique event id |
| `org_id` | UUID | tenant id |
| `type` | enum `COMMENT_POSTED` \| `MENTION` \| `REACTION` \| … |
| `room_id` | bigint | originating room |
| `actor_id` | text | user who triggered |
| `target_ids` | text[] | recipients (user_ids) |
| `payload` | JSONB | event‐specific data |
| `ts` | timestamptz | emit time |

Serialized with **Protobuf** on NATS subject `notif.org.{orgId}`.

### 3.2 `notif.Receipt`
| Field | Type | Notes |
|-------|------|-------|
| `event_id` | ULID | original event |
| `channel` | enum `IN_APP` `EMAIL` `SLACK` `TEAMS` `WEB_PUSH` |
| `recipient` | text | user_id or external identifier |
| `status` | enum `DELIVERED` `FAILED` |
| `error` | text? | optional msg |
| `attempt` | int | retry count |
| `ts` | timestamptz | |

Receipts published on `notif.receipt` stream for monitoring & retries.

---

## 4. Data Model
```sql
CREATE TABLE notification_preferences (
  user_id   TEXT PRIMARY KEY,
  channel   TEXT[] DEFAULT '{IN_APP,EMAIL}',
  event_map JSONB  -- { "COMMENT_POSTED": ["EMAIL"], "MENTION": ["EMAIL","SLACK"] }
);

CREATE TABLE notifications_inbox (
  id        ULID PRIMARY KEY,
  user_id   TEXT NOT NULL,
  event_id  ULID NOT NULL,
  payload   JSONB,
  seen      BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```
*Redis* holds hot cache `pref:{userId}` (TTL 60 s) to reduce Postgres hits.

---

## 5. Delivery Router Logic
1. Consume event ➜ expand `target_ids`.  
2. Fetch user prefs (Redis fallback→DB).  
3. For each channel in prefs intersect PlanLimits:  
   * Render template (Handlebars) using `payload`.  
   * Push to channel worker queue (in‑memory Treiber stack).  
4. Summary receipts: one `Receipt` per channel‑recipient pair.

---

## 6. Channel Adapters
### 6.1 SES Email Adapter
* Uses **BulkTemplatedEmail** for up to 50 destinations/batch.  
* Templates stored in S3 + cached in DynamoDB global table.  
* SPF/DKIM set; DMARC aligned.

### 6.2 Slack Adapter
* Lookup user Slack ID via `slack_user_map` table.  
* POST JSON payload `{text, blocks}` to Webhook URL.  
* Retry 3x exponential backoff; fail ➜ DLQ.

### 6.3 Teams Adapter
* Similar to Slack; card JSON payload.

### 6.4 Web Push Adapter
* VAPID keys stored in KMS; uses `web-push` library.  
* Endpoint & keys stored per‑browser in `web_push_subscriptions` table; TTL 90 days.

---

## 7. In‑App Inbox SDK
```ts
const { useNotifications, markSeen } = createNotificationHooks();

function Inbox() {
  const notifs = useNotifications();
  return <NotificationList items={notifs} onSeen={markSeen} />;
}
```
*WS messages `0x20 notif_inbox` w/ payload ULID   + JSON body.*

---

## 8. Quotas & Billing
* ClickHouse materialized view aggregates `notif.receipt` counts per org/day.  
* Free tier hard stop at 10 k/month; Pro at 1 M, overages \$0.10 per 10 k.

---

## 9. Metrics & SLOs
| Metric | Target |
|--------|--------|
| `notif_delivery_p99_ms` | ≤ 2 000 ms |
| `notif_fail_ratio` | < 0.2 % |
| `inbox_ws_rtt_ms p95` | ≤ 60 ms |
| `pref_cache_hit_ratio` | > 90 % |

Grafana dashboards; alerts on fail ratio >1 % 5 min.

---

## 10. Testing Plan
1. **Unit** – template rendering, pref merge.  
2. **Integration** – SES sandbox, Slack staging webhook.  
3. **Load** – 10k events/s, verify JetStream ack lag <100 ms.  
4. **Chaos** – Drop SES network, ensure retries & DLQ.  
5. **E2E** – Cypress checks inbox UI + email inbox via MailHog.

---

## 11. Security & Compliance
* **PII** in payload minimized; redact before logs.
* HMAC signature header on Webhooks for internal services.
* SES sending domains SPF/DKIM; BIMI future.

---

## 12. Rollout Strategy
1. **Canary org** internal; email only.  
2. Add Slack & Teams; verify receipts.  
3. Enable Web Push for beta group.  
4. GA; enforce quotas.

---

## 13. Future Enhancements
* **Digest mode** – batch low‑priority emails daily.  
* **User rules** – “mute thread”, “follow thread”.  
* **In‑app toast** component for live alerts.

