"use client";

import { useState } from "react";

export default function CompanyForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (company: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
      className="flex flex-col gap-3 sm:flex-row"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Shopify, Anduril, a local bakery chain…"
        disabled={disabled}
        className="hairline w-full flex-1 border-b-2 bg-transparent px-1 py-2 text-lg font-display placeholder:text-ink/40 focus:border-ink"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="border-2 border-ink px-6 py-2 text-sm font-semibold uppercase tracking-widest transition disabled:opacity-30 hover:bg-ink hover:text-paper disabled:hover:bg-transparent disabled:hover:text-ink"
      >
        {disabled ? "Researching…" : "Open a file"}
      </button>
    </form>
  );
}
