# Research Desk — AI Investment Research Agent

Give it a company name. It researches the open web, drafts a brief, and an "investment
committee" model stamps a final verdict — **INVEST / PASS / WATCH** — with full reasoning,
a bull case, a bear case, risks, a financial snapshot, and the sources it actually read.

---

## Overview

You type a company name into a single input box. Behind the scenes:

1. A **research agent** (LangGraph.js StateGraph loop) outputs one JSON action per turn —
   `web_search`, `stock_quote`, or `finish` — calling live tools and building up a
   structured research brief covering overview, financials/funding, competitive landscape,
   recent news, and risks.
2. A **decision step** takes that brief and renders a strict, Zod-validated verdict:
   `INVEST`, `PASS`, or `WATCH`, with confidence, a thesis, bull/bear points, risks,
   catalysts, and a financial snapshot table.
3. The frontend streams the agent's progress live (as it researches) and then renders the
   result as a one-page "investment memo" — complete with a rotated rubber-stamp verdict
   badge and a clickable source list.

It works for public companies, private companies, and startups — the research brief and
verdict gracefully degrade to "here's what's actually known, and here's what isn't" rather
than hallucinating financials that don't exist.

---

## How to run it

**Requirements:** Node.js 18.18+ (Node 20 recommended), npm.

```bash
cd investment-research-agent
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
# LLM — runs GPT-4.1-mini via Replicate
REPLICATE_API_TOKEN=r8_...   # get one at https://replicate.com/account/api-tokens

# Web search — powers the agent's web_search action
TAVILY_API_KEY=tvly-...      # free tier at https://tavily.com
```

Then:

```bash
npm run dev
```

Open `http://localhost:3000`, type a company name, and submit.

> **No `TAVILY_API_KEY`?** The agent still runs — the `web_search` function tells the model
> search is unavailable, and the model is instructed to say so explicitly in its analysis
> and lower its confidence accordingly, rather than silently making things up.

### Deploying (Vercel)

```bash
npm i -g vercel
vercel
```

Add the same environment variables in the Vercel project dashboard (Settings → Environment
Variables), then redeploy. The research route is a standard Next.js Route Handler running
on the Node.js runtime, with `maxDuration` raised to 120s since multi-step research can take
30–90s depending on how many searches the agent decides to run.

---

## How it works

### Architecture

```
 ┌──────────────┐      POST /api/research        ┌────────────────────────┐
 │  Next.js UI  │ ───────────────────────────────▶│  Route Handler (Node)  │
 │ (React, no   │ ◀─── NDJSON stream: log/result ─│  app/api/research/     │
 │  state lib)  │                                  └──────────┬─────────────┘
 └──────────────┘                                             │
                                                               ▼
                                              ┌─────────────────────────────────┐
                                              │   LangGraph.js StateGraph        │
                                              │                                   │
                                              │   ┌────────┐ tool_calls ┌──────┐  │
                                              │   │ agent  │──────────▶│ tools │  │
                                              │   │(Repli- │◀──────────│ node  │  │
                                              │   │ cate)  │  results  └──────┘  │
                                              │   └───┬────┘                      │
                                              │       │ no more tool calls        │
                                              │       ▼                            │
                                              │  research brief (text)            │
                                              └───────────────┬───────────────────┘
                                                               │
                                                               ▼
                                              ┌─────────────────────────────────┐
                                              │ Decision model (ChatReplicate)   │
                                              │ → extractJson + Zod safeParse    │
                                              │ → INVEST / PASS / WATCH          │
                                              └─────────────────────────────────┘
```

- **LLM provider** — `ChatReplicate`, a custom `BaseChatModel` subclass
  (`lib/agent/chat-replicate.ts`) that calls Replicate's hosted `openai/gpt-4.1-mini`. It
  extends LangChain's `BaseChatModel` and implements `bindTools()` + `_generate()` to
  emulate native function-calling: tool schemas are injected into the system prompt, and the
  model's JSON response is parsed into `AIMessage.tool_calls` automatically. This means
  `ToolNode`, `bindTools()`, and `tool()` all work the standard LangChain way — if you ever
  swap to a real function-calling provider, only `chat-replicate.ts` changes.
- **Research phase** — a `StateGraph` (LangGraph.js) with two nodes: `agent` (the LLM,
  bound to tools via `bindTools`) and `tools` (a standard `ToolNode` that dispatches
  whichever tools the LLM called). A conditional edge keeps looping `agent → tools → agent`
  until the model stops calling tools (or hits a safety cap of 10 tool-calling turns), at
  which point it must have written a plain-text research brief. This is a standard ReAct
  pattern, kept deliberately small and inspectable.
- **Tools**: `web_search` (Tavily REST API — real, current web results) and `stock_quote`
  (a free, no-key Stooq lookup for a quick public-market sanity check). Both use standard
  LangChain `tool()` wrappers with Zod schemas, so `ToolNode` dispatches them automatically.
  The model decides when and how many times to call each.
- **Decision phase** — a second `ChatReplicate` call (temperature 0.1, no tools bound),
  *not* in the tool loop, that receives only the finished research brief. The raw response
  is parsed with `extractJson()` and validated with `InvestmentDecisionSchema.safeParse()`.
  On validation failure, the Zod error is fed back and the model retries once.
- **Streaming** — the route handler returns a `ReadableStream` of newline-delimited JSON:
  `{"type":"log", ...}` lines as the agent works, then one `{"type":"result", ...}` line
  with the full structured payload (or `{"type":"error", ...}` on failure). The frontend
  reads this with a plain `fetch` + `ReadableStream` reader — no extra streaming library.
- **Frontend** — plain React state (no Redux/Zustand needed for this scope), Tailwind for
  styling, and one custom component per memo section. The visual concept ("research memo
  with a rubber-stamp verdict") was a deliberate choice to make the output feel like a
  decision document rather than a generic chat answer.

### File map

```
app/
  page.tsx                 client page: form, live log, renders the memo
  api/research/route.ts    streaming API route — the only server entrypoint
  layout.tsx, globals.css
components/
  CompanyForm.tsx          input + submit
  LogFeed.tsx              live "thinking out loud" stream
  VerdictStamp.tsx         the rotated INVEST/PASS/WATCH stamp
  ResearchMemo.tsx         full memo layout (thesis, bull/bear, risks, sources…)
lib/agent/
  chat-replicate.ts        ChatReplicate — BaseChatModel wrapper with emulated bindTools()
  json-utils.ts            extractJson() — pull JSON from free-form model output
  types.ts                 Zod schema for the structured decision + shared types
  tools.ts                 web_search + stock_quote tool definitions (LangChain tool() wrappers)
  prompts.ts               system prompts for research vs. decision phases
  graph.ts                 the LangGraph StateGraph + orchestration logic
```

---

## Key decisions & trade-offs

- **Replicate instead of direct OpenAI/Anthropic API keys.** Using `openai/gpt-4.1-mini`
  hosted on Replicate means only one API token is needed, with no separate OpenAI or
  Anthropic billing. The trade-off is slightly higher latency per prediction (Replicate
  cold-start/queue time) and no native tool calling — which is why `ChatReplicate` emulates
  it via text-prompted JSON.
- **Emulated tool calling inside the model wrapper, not the graph.** Replicate has no native
  function-calling API, but `ChatReplicate.bindTools()` injects tool schemas into the system
  prompt and `_generate()` parses the model's JSON response into standard `tool_calls`
  arrays. This keeps the graph/orchestration layer provider-agnostic — `graph.ts` uses the
  exact same `bindTools` + `ToolNode` pattern it would with `ChatOpenAI`, and swapping back
  to a real function-calling model later only requires changing the model class.
- **Two-phase agent (research → decide) instead of one giant agent loop.** A single agent
  that researches *and* decides in the same loop tends to lock in a verdict early and
  rationalize backward as it keeps searching. Splitting "gather" from "judge" into two LLM
  calls, with the judgment call validated through a Zod schema, produced more consistent,
  better-grounded verdicts in testing — at the cost of an extra LLM call per run.
- **Zod `safeParse` + retry for the decision step.** The decision model has no tools bound,
  so it outputs plain text. `extractJson()` + `safeParse()` validate the structure, and on
  failure the Zod errors are fed back for one retry. This is simpler and more transparent
  than trying to emulate `.withStructuredOutput()`.
- **Direct REST call to Tavily instead of `@langchain/community`'s wrapper.** The community
  package pulls in a long, fragile dependency tree (it transitively wants `better-sqlite3`,
  `typeorm`, etc. for unrelated integrations) that caused peer-dependency resolution errors.
  A ~20-line `fetch` call gets the same data with zero extra dependencies and is easier to
  reason about.
- **NDJSON streaming over a hand-rolled WebSocket/SSE setup.** Good enough to show live
  progress without pulling in a pub/sub layer or a separate server process — appropriate
  for a single-request, single-response agent run.
- **No persistence / no auth / no multi-turn chat.** Optimized for the one flow of "takes a
  company name, researches, decides" being solid rather than spreading effort across a login
  system, a history page, or a database.

### What I left out (and would add given more time)

- A real fundamentals/SEC-filings data source (e.g. financial-statements API) instead of a
  free spot-quote lookup.
- Parallel/fan-out search (multiple `web_search` calls issued concurrently per turn) instead
  of one tool call at a time, to cut latency.
- A "show your work" expandable view of the full research brief and raw tool call/response
  trace (the data is already collected in `researchLog` — it's just not surfaced in the UI).
- Caching identical company queries for some TTL, since a re-run today should mostly agree
  with a re-run an hour ago.
- Automated evals: a small fixed set of companies with a known "obviously strong" / "obviously
  weak" profile, run nightly against the agent to catch prompt regressions.

---

## Example runs

These are illustrative example outputs in the agent's actual output shape (i.e. straight from
`InvestmentDecisionSchema`) — produced by working through the agent's prompts and tool
outputs manually. Once you add real API keys, running these same company names through the
app will produce a live equivalent grounded in that day's actual search results — likely
with different specifics than below, since the underlying facts the agent finds will differ
over time.

### 1. "Anduril Industries" → `WATCH`

> **Thesis:** Anduril has built genuine defense-tech credibility and a fast-growing
> contract book, but as a private company its financials are opaque and its valuation is
> set entirely by future funding rounds, not earnings — a real story, but not yet a
> priceable one for a public-equity-style verdict.
>
> **Bull case:** Multiple large government contracts; founder-led with deep pockets and a
> credible track record (Palmer Luckey/Oculus); positioned in a structurally growing
> category (autonomous defense systems) with bipartisan political tailwinds.
> **Bear case:** Single-customer-type concentration risk (government budgets, procurement
> cycles); no public financials to verify margins or burn rate; valuation set by
> momentum-driven private funding rounds rather than fundamentals.
> **Key risks:** Defense procurement is slow and politically exposed; private-market
> liquidity is limited for outside investors; reliance on continued large funding rounds.
> **Catalysts:** Any future IPO filing or audited financial disclosure would resolve most
> of the "WATCH" uncertainty.

### 2. "Peloton Interactive" → `PASS`

> **Thesis:** Peloton's post-pandemic demand collapse exposed a hardware-subscription
> model that doesn't have the retention economics it assumed during 2020–2021, and
> repeated turnaround attempts haven't yet produced durable profitability.
>
> **Bull case:** Strong brand recognition; large installed base of existing hardware
> owners; subscription revenue is stickier than hardware revenue once someone owns a bike.
> **Bear case:** Demand pulled forward during the pandemic, leaving a smaller realistic
> long-term market; repeated leadership and strategy changes; hardware margins remain
> structurally thin.
> **Key risks:** Continued subscriber churn; competitive pressure from lower-cost
> alternatives (gyms reopening, cheaper connected-fitness entrants); execution risk on yet
> another turnaround plan.

### 3. "A profitable, debt-free regional bakery chain (hypothetical, 40 locations, steady 8% YoY same-store growth)" → `INVEST`

> **Thesis:** Boring, profitable, growing steadily, no balance-sheet risk — exactly the
> profile that doesn't show up in headlines but compounds quietly.
>
> **Bull case:** Profitable and debt-free reduces downside risk materially; steady
> same-store growth suggests real, non-promotional demand; regional concentration is a
> known, bounded expansion opportunity (more cities, same playbook).
> **Bear case:** Small scale limits diversification; thin public information (hypothetical/
> private) limits verification; regional/local-market dependency.
> **Key risks:** Key-person/family-ownership risk common to private regional chains;
> input-cost inflation (flour, dairy, labor) compressing already-thin food-service margins.

*(This third example deliberately shows the "thin/no public data" path — the agent is
prompted to be honest about data limits rather than invent numbers for a company it can't
actually find.)*

---

## Recent changes

### Download report as PDF

Users can now download the full investment memo as a PDF that looks exactly like the web
version. A "Download Report" button appears in the memo header (next to the verdict stamp)
once the analysis completes. Clicking it opens the browser's print dialog — choose
"Save as PDF" to export. The PDF includes all memo sections (thesis, bull/bear case,
financial snapshot, risks, catalysts, sources) with the same styling, verdict stamp, and
layout as the web view. Source URLs are automatically appended to links in the PDF.

**Files added:** `lib/download-report.ts`
**Files changed:** `components/ResearchMemo.tsx`, `app/globals.css`

### Clean progress log messages

Replaced raw, noisy log output like `Calling tool: web_search ({"query":"..."})` and
repeated `Analyst is researching...` lines with clean, human-readable progress messages:

```
Starting research on "Shopify"
Analyst is researching...
Searching web: "Shopify company overview business model"
Analyst is researching...
Searching web: "Shopify latest financial results 2024"
Analyst is researching...
Fetching stock quote: "SHOP"
Analyst is researching...
Research complete.
Research complete. Handing brief to Investment Committee for a decision...
› Decision rendered.
```

**Files changed:** `lib/agent/graph.ts`

### Tool-call context preserved in message history

Fixed a bug in `ChatReplicate._generate()` where AIMessages containing tool calls had empty
`content` — so on the next turn, the model saw `"ai: "` (blank) followed by a raw tool
result with no indication of what it asked for or which tool produced it. Over multi-step
research loops this caused the model to lose track of prior queries, repeat searches, or
misattribute results.

The message history reconstruction now properly serializes:
- **Tool-calling turns:** `ai: [called tool: web_search({"query":"..."})]`
- **Tool result turns:** `tool result (web_search): <result text>`

**Files changed:** `lib/agent/chat-replicate.ts`

### Prompt alignment for research termination

The research system prompt previously told the model to _"STOP calling tools and write a
concise research brief in plain text"_, but `ChatReplicate`'s injected tool instructions
require the model to use `{"final_answer": "..."}` format when finishing. These conflicting
instructions caused inconsistent termination behavior across runs, especially with smaller
models.

The research prompt now defers to the tool-calling format: _"give your `final_answer` (per
the tool-calling format instructions you've been given)"_ — eliminating the ambiguity.

**Files changed:** `lib/agent/prompts.ts`

---

## What I would improve with more time

1. **Surface the full research trace in the UI** (collapsible "show the analyst's notes"
   section) instead of only a one-line-per-step progress feed.
2. **Add a real fundamentals data source** for any company with public filings, and clearly
   visually distinguish "verified financial data" from "claims found in news coverage."
3. **Parallelize search calls** within a single research turn to cut wall-clock time.
4. **Add a lightweight eval harness**: a fixed list of test companies + expected verdict
   direction, run against the agent on every prompt change, to catch regressions before
   they ship.
5. **Memory across a session** — let a user ask a follow-up question about the memo
   ("what about their debt load?") without re-running the whole pipeline from scratch.

