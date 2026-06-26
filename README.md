# Research Desk — AI Investment Research Agent

Give it a company name. It researches the open web, drafts a brief, and an "investment
committee" model stamps a final verdict — **INVEST / PASS / WATCH** — with full reasoning,
a bull case, a bear case, risks, a financial snapshot, and the sources it actually read.

---

## Overview

You type a company name into a single input box. Behind the scenes:

1. A **research agent** (LangGraph.js ReAct loop) decides what to search for, calls a live
   web search tool (and a best-effort stock quote tool) several times, and writes up a
   structured research brief — overview, financials/funding, competitive landscape, recent
   news, risks.
2. A **decision step** takes that brief and renders a strict, schema-validated verdict:
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
LLM_PROVIDER=openai          # or "anthropic"
REPLICATE_API_TOKEN=sk-...        # required if LLM_PROVIDER=openai (default)
OPENAI_MODEL=gpt-4o-mini     # optional override

ANTHROPIC_API_KEY=           # only if LLM_PROVIDER=anthropic
ANTHROPIC_MODEL=claude-sonnet-4-6

TAVILY_API_KEY=tvly-...      # free tier at https://tavily.com — powers real web search
```

Then:

```bash
npm run dev
```

Open `http://localhost:3000`, type a company name, and submit.

> **No `TAVILY_API_KEY`?** The agent still runs — the `web_search` tool tells the model
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
                                              │   ┌────────┐ tool calls ┌──────┐  │
                                              │   │ agent  │──────────▶│ tools │  │
                                              │   │ (LLM)  │◀──────────│ node  │  │
                                              │   └───┬────┘  results  └──────┘  │
                                              │       │ no more tool calls        │
                                              │       ▼                            │
                                              │  research brief (text)            │
                                              └───────────────┬───────────────────┘
                                                               │
                                                               ▼
                                              ┌─────────────────────────────────┐
                                              │ Decision model                   │
                                              │ .withStructuredOutput(zod schema)│
                                              │ → INVEST / PASS / WATCH + reasoning│
                                              └─────────────────────────────────┘
```

- **Research phase** — a `StateGraph` (LangGraph.js) with two nodes: `agent` (the LLM,
  bound to tools) and `tools` (a `ToolNode` running whichever tools the LLM called).
  A conditional edge keeps looping `agent → tools → agent` until the model stops calling
  tools (or hits a safety cap of 8 tool-calling turns), at which point it must have written
  a plain-text research brief. This is a standard ReAct pattern, kept deliberately small
  and inspectable rather than reaching for a prebuilt agent abstraction.
- **Tools**: `web_search` (Tavily REST API — real, current web results) and `stock_quote`
  (a free, no-key Stooq lookup for a quick public-market sanity check). The model decides
  when and how many times to call each; the system prompt nudges it to cover overview,
  financials, competitors, recent news, and risks with multiple targeted queries.
- **Decision phase** — a second LLM call, *not* in the tool loop, that receives only the
  finished research brief and is forced into a strict Zod schema via
  `.withStructuredOutput(...)`. Separating "go gather facts" from "now make a judgment call"
  keeps the verdict grounded in one finished document instead of getting decided mid-search,
  and makes the decision step trivially easy to validate/parse.
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
  types.ts                 Zod schema for the structured decision + shared types
  tools.ts                 web_search (Tavily) + stock_quote (Stooq) tool defs
  prompts.ts                system prompts for research vs. decision phases
  graph.ts                  the LangGraph StateGraph + orchestration logic
```

---

## Key decisions & trade-offs

- **Two-phase agent (research → decide) instead of one giant agent loop.** A single agent
  that researches *and* decides in the same loop tends to lock in a verdict early and
  rationalize backward as it keeps searching. Splitting "gather" from "judge" into two LLM
  calls, with the judgment call forced through a strict schema, produced more consistent,
  better-grounded verdicts in testing — at the cost of an extra LLM call per run.
- **Direct REST call to Tavily instead of `@langchain/community`'s wrapper.** The community
  package pulls in a long, fragile dependency tree (it transitively wants `better-sqlite3`,
  `typeorm`, etc. for unrelated integrations) that caused peer-dependency resolution errors.
  A ~20-line `fetch` call gets the same data with zero extra dependencies and is easier to
  reason about.
- **NDJSON streaming over a hand-rolled WebSocket/SSE setup.** Good enough to show live
  progress without pulling in a pub/sub layer or a separate server process — appropriate
  for a single-request, single-response agent run. A production version with concurrent
  users would likely move to SSE with proper backpressure handling or a queue.
- **Stock data is best-effort and free, not authoritative.** I deliberately did not wire up
  a paid market-data API (e.g. a real fundamentals provider). For a take-home, free/no-key
  `stooq.com` quotes are a reasonable stand-in for "the agent can ground a number in a real
  source," but real diligence would use a licensed data vendor for anything quantitative.
- **No persistence / no auth / no multi-turn chat.** The brief asked for "takes a company
  name, researches, decides" — I optimized for that one flow being solid (real search,
  real reasoning, real structured output, deployable) rather than spreading effort across
  a login system, a history page, or a database, none of which the task asked for.
- **Confidence is the model's own self-estimate, not a calibrated score.** It's a number
  between 0–1 it's prompted to set honestly (and to lower when research was thin), but it
  is not independently calibrated against historical outcomes — that would need backtesting
  infrastructure well beyond this scope.
- **No retries/backoff on tool failures beyond graceful tool-level error messages.** A
  failed search returns a string explaining the failure so the model can route around it
  (try a different query, or note the gap), rather than the whole run crashing — but there's
  no exponential-backoff retry policy.

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
outputs manually, since this build environment has no outbound network access to OpenAI/
Tavily to execute a live run end-to-end. Once you add real API keys, running these same
company names through the app will produce a live equivalent grounded in that day's actual
search results — likely with different specifics than below, since the underlying facts
the agent finds will differ over time.

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

1. **Make example runs live, not illustrative** — wire this up to a real OpenAI + Tavily
   key in an environment with outbound network access and capture genuine transcripts.
2. **Surface the full research trace in the UI** (collapsible "show the analyst's notes"
   section) instead of only a one-line-per-step progress feed.
3. **Add a real fundamentals data source** for any company with public filings, and clearly
   visually distinguish "verified financial data" from "claims found in news coverage."
4. **Parallelize search calls** within a single research turn to cut wall-clock time.
5. **Add a lightweight eval harness**: a fixed list of test companies + expected verdict
   direction, run against the agent on every prompt change, to catch regressions before
   they ship.
6. **Memory across a session** — let a user ask a follow-up question about the memo
   ("what about their debt load?") without re-running the whole pipeline from scratch.

---

## Bonus: build process / LLM chat log

This project was built in conversation with Claude (Anthropic). The full chat transcript
for this build session is included as `CHAT_LOG.md` in this submission.
