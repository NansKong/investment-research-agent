"use client";

export default function LogFeed({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="hairline border-l-2 pl-4 font-mono text-[13px] leading-relaxed text-ink/60">
      {lines.map((line, i) => (
        <div key={i} className={i === lines.length - 1 ? "text-ink" : ""}>
          {i === lines.length - 1 ? "› " : "  "}
          {line}
        </div>
      ))}
    </div>
  );
}
