# Build session transcript

This is the chat transcript for the session in which this project was built with Claude
(Anthropic), in Claude's chat interface.

---

**User:**

> The Task • Build an AI Investment Research Agent: it takes a company name, does its
> research, and decides whether to invest or pass — with the reasoning behind its decision.
> • That's the goal — how you build it (what it researches, how it works under the hood, how
> it shows its results) is entirely up to you. We care about what you build and how you build
> it. Tech stack (this is our production stack — please build with it) • React or Next.js
> (front end) · Node.js or Next.js (back end) · LangChain.js / LangGraph.js (for the AI). •
> Within that, use any LLM provider and any other libraries / APIs / tools you like. • Use AI
> as much as you like while building (that's the job). • Deploying online (e.g. on Vercel) and
> sharing the link will carry bonus points. Time • 7 days. What to submit A zip file which
> includes your code and a README with these sections: • Overview... • How to run it... • How
> it works... • Key decisions & trade-offs... • Example runs... • What you would improve with
> more time • BONUS points: you are mandated to build this project using a choice of your
> AI/LLM, during which you will be chatting with the LLM as you build. You will get extra
> bonus points if you include all the LLM chat session transcript/logs.
>
> check this

**Claude:** Asked two quick clarifying questions before building, to lock in the stack
specifics that would otherwise need guessing: which LLM provider to default to, and whether
to wire up real live web search vs. mock data.

**User:** Chose OpenAI (GPT-4o/4o-mini) as the default provider, and confirmed: yes, wire up
real web search via Tavily.

**Claude:** Proceeded to build the full project:

1. Scaffolded a Next.js 14 (App Router) + TypeScript + Tailwind project by hand (package.json,
   tsconfig, Tailwind/PostCSS config) rather than via `create-next-app`, for full control over
   the dependency list.
2. Designed the agent architecture: a two-phase LangGraph.js pipeline — a ReAct-style
   `StateGraph` (`agent` ↔ `tools` nodes) for open-ended research, followed by a separate,
   schema-constrained decision call (`withStructuredOutput` against a Zod schema) so the
   final verdict is always valid, parseable JSON.
3. Implemented two tools: `web_search` (originally via `@langchain/community`'s Tavily
   wrapper; switched to a direct `fetch` call to Tavily's REST API after the community
   package's transitive dependencies — `better-sqlite3`, `typeorm`, etc. — caused npm
   `ERESOLVE` peer-dependency conflicts) and `stock_quote` (a free, no-API-key lookup against
   Stooq's CSV endpoint, as a best-effort public-market sanity check).
4. Wrote the system prompts splitting "research analyst" behavior (gather facts, write a
   brief, don't decide yet) from "investment committee" behavior (be decisive, ground every
   claim in the brief, use WATCH sparingly).
5. Built the API route as a Next.js Route Handler returning a streamed NDJSON response, so the
   frontend can show live progress ("Calling tool: web_search...") while the agent works,
   followed by a final structured result payload.
6. Designed the frontend around a "research memo with a rubber-stamp verdict" concept
   (Georgia/serif headlines, paper-colored background, hairline rule dividers, a rotated
   INVEST/PASS/WATCH stamp badge with a subtle stamp-down animation) instead of a generic
   chat-style answer, to make the output read like an actual decision document.
7. Validated the build end-to-end in a sandboxed environment: ran `npm install` (catching and
   fixing the Tavily/community dependency conflict), then `npx next build` with dummy env vars
   to confirm there were no TypeScript or compile errors (fixed one TS union-type error on
   `withStructuredOutput` against a provider-agnostic model getter).
8. Wrote the README (overview, run instructions, architecture diagram, key decisions &
   trade-offs, example runs, future improvements) and this transcript file, then packaged
   everything into a zip for submission.

Note: live example runs against real OpenAI/Tavily API keys could not be executed inside this
particular build environment (no outbound network access to those providers), so the README's
"Example runs" section is explicitly labeled as illustrative output in the agent's real
response shape, reasoned through by hand from the actual prompts/tools shipped in this repo —
not a fabricated transcript dressed up as a live one.