import { z } from "zod";

/** Single piece of evidence gathered during research, with its source. */
export const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

/** The final structured output the agent must produce. */
export const InvestmentDecisionSchema = z.object({
  company: z.string().describe("Resolved/canonical company name"),
  ticker: z.string().nullable().describe("Stock ticker if publicly traded, else null"),
  verdict: z.enum(["INVEST", "PASS", "WATCH"]).describe(
    "WATCH means promising but needs more confirmation/time before committing capital"
  ),
  confidence: z.number().min(0).max(1).describe("0-1 confidence in the verdict"),
  thesis: z.string().describe("2-4 sentence plain-English summary of the overall investment thesis"),
  bullCase: z.array(z.string()).describe("3-6 concrete bullish points, each grounded in research"),
  bearCase: z.array(z.string()).describe("3-6 concrete bearish/risk points, each grounded in research"),
  financialSnapshot: z
    .array(
      z.object({
        metric: z.string(),
        value: z.string(),
        commentary: z.string().optional(),
      })
    )
    .describe("Key financial/business metrics found during research (revenue, growth, margins, valuation, etc.)"),
  competitivePosition: z.string().describe("1-3 sentences on moat, market position, and competitive threats"),
  keyRisks: z.array(z.string()).describe("3-5 specific, non-generic risks"),
  catalysts: z.array(z.string()).describe("Near-term catalysts or events that could move the thesis, if any"),
  recommendationRationale: z
    .string()
    .describe("The decisive reasoning: why INVEST/PASS/WATCH given everything above, in 2-5 sentences"),
});
export type InvestmentDecision = z.infer<typeof InvestmentDecisionSchema>;

export interface AgentRunResult {
  decision: InvestmentDecision;
  sources: Source[];
  researchLog: string[];
  durationMs: number;
}
