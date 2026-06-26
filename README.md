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
                                              │   ┌────────┐  JSON action         │
                                              │   │ agent  │──── parse ──┐        │
                                              │   │(Repli- │◀── result ──┤        │
                                              │   │ cate)  │             │        │
                                              │   └───┬────┘   webSearch()        │
                                              │       │        stockQuote()       │
                                              │       │ action = "finish"         │
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

- **LLM provider** — `ChatReplicate`, a custom `SimpleChatModel` subclass
  (`lib/agent/chat-replicate.ts`) that calls Replicate's hosted `openai/gpt-4.1-mini`. It
  extends LangChain's `SimpleChatModel` so it plugs into `.invoke(state.messages)` the same
  way `ChatOpenAI` would. No OpenAI or Anthropic API keys are needed.
- **Research phase** — a `StateGraph` (LangGraph.js) with a single `agent` node. Instead of
  native tool calling + `ToolNode`, the agent outputs one JSON action per turn
  (`{"action": "web_search", "query": "..."}`, `{"action": "stock_quote", "ticker": "..."}`,
  or `{"action": "finish", "brief": "..."}`). The graph loop parses the JSON with
  `extractJson()`, dispatches the corresponding plain async function, appends the result as
  a `HumanMessage`, and loops back. If the model returns invalid JSON, a retry message is
  appended and it loops back — with a hard cap of 5 agent turns (total AI messages) to
  guarantee termination even if the model gets stuck.
- **Tools**: `webSearch()` (Tavily REST API — real, current web results) and `stockQuote()`
  (a free, no-key Stooq lookup for a quick public-market sanity check). Both are plain
  `async` functions — no LangChain `tool()` wrapper — called directly by the graph loop
  based on the parsed action.
- **Decision phase** — a second `ChatReplicate` call (temperature 0.1), *not* in the graph
  loop, that receives only the finished research brief. Instead of `.withStructuredOutput()`,
  the raw response is parsed with `extractJson()` and validated with
  `InvestmentDecisionSchema.safeParse()`. On validation failure, the error is fed back and
  the model retries once.
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
  chat-replicate.ts        ChatReplicate — SimpleChatModel wrapper around Replicate
  json-utils.ts            extractJson() — pull JSON from free-form model output
  types.ts                 Zod schema for the structured decision + shared types
  tools.ts                 webSearch() + stockQuote() — plain async functions
  prompts.ts               system prompts for research vs. decision phases
  graph.ts                 the LangGraph StateGraph + orchestration logic
```

---

## Key decisions & trade-offs

- **Replicate instead of direct OpenAI/Anthropic API keys.** Using `openai/gpt-4.1-mini`
  hosted on Replicate means only one API token is needed, with no separate OpenAI or
  Anthropic billing. The trade-off is slightly higher latency per prediction (Replicate
  cold-start/queue time) and no native tool calling — which is why the agent uses a
  JSON-action protocol instead.
- **JSON-action protocol instead of native tool calling.** Since Replicate's model hosting
  doesn't support OpenAI-style `tool_calls` in the response, the agent prompt instructs the
  model to reply with a JSON object specifying the action. `extractJson()` parses it, with
  retry logic for malformed output. This is simpler than it sounds and works reliably with
  `gpt-4.1-mini`, at the cost of needing a retry path for the occasional non-JSON response.
- **Plain async functions instead of LangChain `tool()` wrappers.** Without native tool
  calling, `ToolNode` is unnecessary. `webSearch()` and `stockQuote()` are just async
  functions called directly in the graph loop — same fetch logic, less abstraction.
- **Two-phase agent (research → decide) instead of one giant agent loop.** A single agent
  that researches *and* decides in the same loop tends to lock in a verdict early and
  rationalize backward as it keeps searching. Splitting "gather" from "judge" into two LLM
  calls, with the judgment call validated through a Zod schema, produced more consistent,
  better-grounded verdicts in testing — at the cost of an extra LLM call per run.
- **Zod `safeParse` + retry instead of `.withStructuredOutput()`.** Since `ChatReplicate`
  doesn't support structured output natively, the decision step calls the model, extracts
  JSON, runs `safeParse`, and on failure feeds the Zod validation errors back into the
  prompt for one retry. This handles the same role with explicit error recovery.
- **Direct REST call to Tavily instead of `@langchain/community`'s wrapper.** The community
  package pulls in a long, fragile dependency tree (it transitively wants `better-sqlite3`,
  `typeorm`, etc. for unrelated integrations) that caused peer-dependency resolution errors.
  A ~20-line `fetch` call gets the same data with zero extra dependencies and is easier to
  reason about.
- **NDJSON streaming over a hand-rolled WebSocket/SSE setup.** Good enough to show live
  progress without pulling in a pub/sub layer or a separate server process — appropriate
  for a single-request, single-response agent run.
- **Agent turn cap (5) instead of tool-call cap.** The safety limit counts every AI message,
  not just successful tool calls. This guarantees termination even if the model gets stuck
  on bad JSON or unknown actions — it won't loop forever.
- **No persistence / no auth / no multi-turn chat.** Optimized for the one flow of "takes a
  company name, researches, decides" being solid rather than spreading effort across a login
  system, a history page, or a database.

### What I left out (and would add given more time)

- A real fundamentals/SEC-filings data source (e.g. financial-statements API) instead of a
  free spot-quote lookup.
- Parallel/fan-out search (multiple `web_search` calls issued concurrently per turn) instead
  of one tool call at a time, to cut latency.
- A "show your work" expandable view of the full research brief and raw action/response
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
6. **Bump `MAX_RESEARCH_STEPS`** once latency is optimized — 5 turns is a conservative cap;
   more turns would allow deeper research coverage.
