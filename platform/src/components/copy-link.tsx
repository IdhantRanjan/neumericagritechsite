"use client";

import { useState } from "react";

export function CopyLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}/join/${token}` : `/join/${token}`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="font-mono text-[13px] bg-[var(--forest-tint)] text-forest-ink rounded px-3 py-2 break-all">
        {url}
      </code>
      <button
        type="button"
        className="pill pill--sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
