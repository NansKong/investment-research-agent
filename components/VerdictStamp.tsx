"use client";

const STYLES: Record<string, { color: string; label: string }> = {
  INVEST: { color: "var(--invest)", label: "INVEST" },
  PASS: { color: "var(--pass)", label: "PASS" },
  WATCH: { color: "var(--watch)", label: "WATCH" },
};

export default function VerdictStamp({ verdict, confidence }: { verdict: string; confidence: number }) {
  const style = STYLES[verdict] ?? STYLES.WATCH;
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="stamp-animate font-display select-none rounded-full border-[3px] px-6 py-3 text-center"
        style={{
          borderColor: style.color,
          color: style.color,
          transform: "rotate(-8deg)",
        }}
      >
        <div className="text-2xl font-bold tracking-widest sm:text-3xl">{style.label}</div>
      </div>
      <div className="text-xs uppercase tracking-widest text-ink/50">
        Committee confidence — {Math.round(confidence * 100)}%
      </div>
    </div>
  );
}
