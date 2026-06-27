"use client";

import type { AgentRunResult } from "@/lib/agent/types";
import { downloadReport } from "@/lib/download-report";
import VerdictStamp from "./VerdictStamp";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="hairline border-t pt-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/50">{label}</div>
      {children}
    </section>
  );
}

export default function ResearchMemo({ result }: { result: AgentRunResult }) {
  const { decision, sources, durationMs } = result;

  return (
    <div data-memo className="hairline border bg-paper p-6 sm:p-10">
      <header className="hairline mb-6 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-ink/50">Research Desk — Investment Memo</div>
          <h1 className="font-display mt-1 text-3xl">
            {decision.company}
            {decision.ticker ? <span className="ml-2 text-lg text-ink/50">({decision.ticker})</span> : null}
          </h1>
          <div className="mt-1 text-xs text-ink/40">
            Compiled {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}{" "}
            · {(durationMs / 1000).toFixed(1)}s research time
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <VerdictStamp verdict={decision.verdict} confidence={decision.confidence} />
          <button
            id="download-report-btn"
            onClick={() => downloadReport()}
            className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] transition-all duration-200 hover:bg-ink hover:text-paper hairline print:hidden"
            style={{ borderColor: "var(--hairline)", color: "var(--ink)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download Report
          </button>
        </div>
      </header>

      <div className="space-y-6">
        <Section label="Thesis">
          <p className="font-display text-lg leading-relaxed">{decision.thesis}</p>
        </Section>

        <Section label="Recommendation rationale">
          <p className="leading-relaxed text-ink/80">{decision.recommendationRationale}</p>
        </Section>

        <div className="grid gap-6 sm:grid-cols-2">
          <Section label="Bull case">
            <ul className="space-y-2">
              {decision.bullCase.map((point, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <span style={{ color: "var(--invest)" }}>+</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section label="Bear case">
            <ul className="space-y-2">
              {decision.bearCase.map((point, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <span style={{ color: "var(--pass)" }}>−</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {decision.financialSnapshot.length > 0 && (
          <Section label="Financial snapshot">
            <div className="hairline divide-y border">
              {decision.financialSnapshot.map((row, i) => (
                <div key={i} className="hairline grid grid-cols-3 gap-2 px-3 py-2 text-sm">
                  <div className="font-semibold">{row.metric}</div>
                  <div className="font-mono">{row.value}</div>
                  <div className="col-span-1 text-ink/60">{row.commentary}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section label="Competitive position">
          <p className="text-sm leading-relaxed text-ink/80">{decision.competitivePosition}</p>
        </Section>

        <div className="grid gap-6 sm:grid-cols-2">
          <Section label="Key risks">
            <ul className="space-y-2">
              {decision.keyRisks.map((r, i) => (
                <li key={i} className="text-sm leading-relaxed text-ink/80">
                  · {r}
                </li>
              ))}
            </ul>
          </Section>
          {decision.catalysts.length > 0 && (
            <Section label="Catalysts to watch">
              <ul className="space-y-2">
                {decision.catalysts.map((c, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink/80">
                    · {c}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {sources.length > 0 && (
          <Section label={`Sources (${sources.length})`}>
            <ul className="space-y-2">
              {sources.map((s, i) => (
                <li key={i} className="text-sm">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold underline decoration-ink/30 hover:decoration-ink"
                  >
                    {s.title}
                  </a>
                  <div className="text-ink/50">{s.snippet}</div>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
