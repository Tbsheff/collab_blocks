# CollabBlocks – AI Copilots Technical Plan (v0.1)

*Prepared April 16 2025*

---

## 1. Objective & Definition of Done
Provide an **in‑context AI Copilot** that:
1. Streams natural‑language suggestions and code/text blocks into Realtime Storage via `mutateStorage`.
2. Supports ask‑anything chat, slash‑commands (e.g., `/summarize`, `/brainstorm`), and contextual autocomplete.
3. Delivers first token in ≤ 1 s (p95 NA/EU) and total latency proportional to LLM tokens.
4. Tracks usage per org for billing; hard‑limit at free quota.

---

## 2. High‑Level Architecture
```
Browser SDK ──▶ SSE /v1/copilot/chat ──▶ AI Service (Node 20 + Vercel AI SDK)
                                   │
                                   ├─▶ Provider Router ──▶ OpenAI GPT‑4o
                                   │                      Gemini 1.5 Pro
                                   │                      Anthropic Claude 3
                                   │
                                   ├─▶ Retrieval Layer (Pinecone v3 + Supabase Postgres)
                                   │
                                   └─▶ mutateStorage gRPC → Collab Pod
```
* **AI Service** is stateless; deployed as AWS Lambda @ Edge (for low TTFB) and Kubernetes pod workers for batch tasks.
* **Provider Router** selects model based on org plan, latency, cost, and availability.
* **Retrieval Layer** fetches relevant CRDT blocks (title, section, last 256 ops) ➜ embeddings ➜ vector search ➜ context.

---

## 3. Data Contracts
### 3.1 Client ➜ AI Service Request
```json
{
  "roomId": 12345,
  "prompt": "Suggest better phrasing for this paragraph",
  "mode": "edit" | "chat" | "command",
  "selectionPath": ["doc", 3, "children", 4]
}
```
JWT includes `sub` (userId), `org`, `plan`, `roomId`.

### 3.2 AI Service ➜ Client Stream (SSE)
```
id: <ulid>
event: token
data: {"content":"Better phrasing ..."}
```
`event: done` terminates stream.

### 3.3 `mutateStorage` Payload
```ts
interface MutateOps {
  type: "replace_text" | "insert_block" | "comment";
  path: string[]; // CRDT JSONPointer
  value?: any;
}
```

---

## 4. Prompt Engineering
Template (Handlebars‑style):
```
You are CollabBlocks Copilot assisting {{userName}} (role: {{userRole}})
Context:
{{#each contextChunks}}
<chunk id={{id}}>
{{content}}
</chunk>
{{/each}}

Task: {{task}}
Guidelines:
- Use Markdown.
- Stay under {{maxTokens}} tokens.
- For edits, reply with JSON {"ops": [...]}.
```
* **System message** static; **contextChunks** truncated via *maxTokens* heuristic (reserve 30 % for answer).
* Re‑rank chunks with GPT‑4o embeddings cosine similarity; top 8.

---

## 5. Retrieval Pipeline
1. On trigger, AI Service requests `contextLoader` for room snapshot path selection.
2. Snapshot text blocks tokenized ➜ embeddings pre‑generated in **Embeddings Worker** every 10 min.
3. **Pinecone** query (top k=8, filter `roomId`).
4. For `command` mode (e.g., `/summarize`), bypass Pinecone and use last N ops diff.

---

## 6. mutateStorage Workflow
* AI Service converts LLM `ops` JSON to Protobuf `StorageOp` and calls `gRPC Mutate` on Collab Pod leader.
* Pod validates auth (`origin=ai:svc`) & quota, applies ops to Yjs doc, broadcasts to clients.
* On failure (conflict), Pod returns `409`; AI Service retries with fresh snapshot (max 2 retries).

---

## 7. Cost & Quota Enforcement
* ClickHouse table `ai_usage` (org_id, tokens_in, tokens_out, model, ts).
* Usage metered via OpenAI billing headers or token estimate for non‑OpenAI.
* Free quota 50 k tokens/mo; Pro 1 M; overage \$0.002/1 k tokens.
* Hard cut: if usage_today > plan_limit → respond HTTP 402 quota exceeded.

---

## 8. Security & Guardrails
* **Content Filter** – OpenAI content policy endpoint; fallback local regex filter for profanity.
* **Prompt Injection Defense** – Add prepend system prompt enforcing no code execution.
* **Personally Identifiable Info (PII)** redacted by regex before logs.
* **Model Failover** – If provider 5xx >3 in 1 min, circuit break to backup.

---

## 9. Metrics & Observability
| Metric | Target |
|--------|--------|
| `copilot_first_token_ms p95` | ≤ 1 000 ms |
| `copilot_stream_duration_ms p95` | ≤ 6 000 ms |
| `copilot_error_rate` | < 1 % |
| `token_cost_usd` | tracked per org |

OpenTelemetry traces for each request with links to Collab Pod mutate RPC.

---

## 10. Testing Plan
1. **Unit** – prompt template rendering, embed similarity.  
2. **Golden Tests** – deterministic outputs with stub models.  
3. **Latency Bench** – 500 concurrent chats; ensure p95.  
4. **Hallucination QA** – LLM QA harness assertions on incorrect data injection.  
5. **Security** – attempt prompt injection (`ignore previous`) ensure guardrail.  
6. **Chaos** – provider outage simulation, verify failover.

---

## 11. Rollout Strategy
1. **Internal Alpha** – Staff only; usage unlimited but logged.  
2. **Private Beta** – 10 design partners (feature flag `ai_beta`).  
3. Monitor cost, latency, error rate; refine prompts.  
4. **Public Beta** – Pro plan opt‑in; quotas enforced.  
5. **GA** – Default enabled, documented pricing.

---

## 12. Future Enhancements
* **Tool‑calling** – structured function calling for tasks like `generate_report`.  
* **Fine‑tuning** on org data (RAG).  
* **Voice input & read‑aloud** via Web Speech API.

