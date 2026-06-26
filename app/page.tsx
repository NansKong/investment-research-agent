"use client";

import { useRef, useState } from "react";
import CompanyForm from "@/components/CompanyForm";
import LogFeed from "@/components/LogFeed";
import ResearchMemo from "@/components/ResearchMemo";
import type { AgentRunResult } from "@/lib/agent/types";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(companyName: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    setLogs([]);
    setCompany(companyName);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: companyName }),
        signal: controller.signal,
      });

      if (!res.body) throw new Error("No response stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "log") {
            setLogs((prev) => [...prev, event.message]);
          } else if (event.type === "result") {
            setResult(event.data);
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-20">
      <div className="mb-10 text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-ink/50">Research Desk</div>
        <h1 className="font-display mt-2 text-4xl sm:text-5xl">An AI analyst that opens a file on any company</h1>
        <p className="mx-auto mt-4 max-w-xl text-ink/60">
          Type a company. It researches the open web, drafts a brief, and an investment committee model
          stamps a verdict — invest, pass, or watch — with the reasoning shown in full.
        </p>
      </div>

      <CompanyForm onSubmit={handleSubmit} disabled={loading} />

      <div className="mt-8 space-y-8">
        {loading && (
          <div className="text-center text-sm text-ink/50">Opening a file on {company}…</div>
        )}
        <LogFeed lines={logs} />
        {error && (
          <div className="hairline border-l-2 pl-4 text-sm" style={{ borderColor: "var(--pass)", color: "var(--pass)" }}>
            {error}
          </div>
        )}
        {result && <ResearchMemo result={result} />}
      </div>

      <footer className="mt-16 text-center text-xs text-ink/30">
        Built with Next.js, LangChain.js &amp; LangGraph.js. Not investment advice.
      </footer>
    </main>
  );
}
