import type { Source } from "./types";

/**
 * Collected sources are pushed into this array as a side effect of tool calls
 * so the final response can show the user exactly what the agent read.
 * A fresh array is created per-request by the caller (see graph.ts) and
 * passed in via `bindSourceSink`.
 */
let sourceSink: Source[] = [];
export function bindSourceSink(sink: Source[]) {
  sourceSink = sink;
}

/**
 * Web search, backed by Tavily. Exported as a plain async function
 * (no LangChain tool() wrapper) — called directly from the graph loop.
 */
export async function webSearch(query: string): Promise<string> {
  if (!process.env.TAVILY_API_KEY) {
    return "Web search is not configured (missing TAVILY_API_KEY). Rely on general knowledge and say so explicitly in your analysis.";
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 5,
      search_depth: "advanced",
    }),
  });

  if (!res.ok) {
    return `Web search failed (HTTP ${res.status}). Try a different/simpler query.`;
  }

  const json = await res.json();
  const results: any[] = Array.isArray(json?.results) ? json.results : [];
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const formatted = results
    .map((r, i) => {
      sourceSink.push({
        title: r.title ?? `Result ${i + 1}`,
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 280),
      });
      return `[${i + 1}] ${r.title}\nURL: ${r.url}\n${(r.content ?? "").slice(0, 500)}`;
    })
    .join("\n\n");

  return formatted;
}

/**
 * Free, no-key stock quote lookup via Stooq's CSV endpoint. Best-effort only:
 * ticker symbols are messy in the real world, so failures are expected and
 * handled gracefully by the agent (it should fall back to web_search).
 * Exported as a plain async function — called directly from the graph loop.
 */
export async function stockQuote(ticker: string): Promise<string> {
  try {
    const symbol = ticker.trim().toLowerCase();
    const res = await fetch(
      `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}.us&f=sd2t2ohlcv&h&e=csv`,
      { cache: "no-store" }
    );
    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return "No quote data found for that ticker.";
    const [header, row] = lines;
    const headers = header.split(",");
    const values = row.split(",");
    if (values[1] === "N/D") return `No live quote available for ticker "${ticker}".`;
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = values[i]));
    return `Quote for ${ticker.toUpperCase()}: date=${obj.Date}, open=${obj.Open}, high=${obj.High}, low=${obj.Low}, close=${obj.Close}, volume=${obj.Volume}`;
  } catch (e) {
    return `Could not fetch a live quote for "${ticker}" (lookup failed). Use web_search instead for valuation context.`;
  }
}
