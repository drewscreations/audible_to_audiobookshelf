"use client";

import { useEffect, useState } from "react";

export function ConnectionBadge() {
  const [status, setStatus] = useState<"checking" | "connected" | "error">(
    "checking"
  );
  const [username, setUsername] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/abs/me");
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.data?.username) {
          setStatus("connected");
          setUsername(json.data.username);
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    check();
    const interval = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          status === "connected"
            ? "bg-green-500"
            : status === "error"
              ? "bg-red-500"
              : "bg-yellow-500 animate-pulse"
        }`}
      />
      {status === "connected"
        ? `ABS: ${username}`
        : status === "error"
          ? "ABS: disconnected"
          : "Checking..."}
    </div>
  );
}
