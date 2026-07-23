"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Zap,
  Loader2,
  Download,
  Sparkles,
  AlertTriangle,
  CircleAlert,
  RefreshCw,
  Headphones,
} from "lucide-react";
import { toast } from "sonner";
import type { SyncCycleResult, SyncStatus } from "@/lib/types";

const INTERVALS = [5, 10, 15, 30, 60];

function relTime(iso?: string): string {
  if (!iso) return "--";
  const ms = Date.parse(iso) - Date.now();
  const abs = Math.abs(ms);
  const fmt =
    abs < 60_000
      ? ms <= 0
        ? "just now"
        : "in <1m"
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`;
  if (abs < 60_000) return fmt;
  return ms < 0 ? `${fmt} ago` : `in ${fmt}`;
}

function titles(books: { title: string }[], max = 2): string {
  const names = books.slice(0, max).map((b) => b.title);
  const extra = books.length - names.length;
  return names.join(", ") + (extra > 0 ? ` +${extra} more` : "");
}

function progressText(entry: SyncCycleResult): string | null {
  const p = entry.progressUpdated ?? 0;
  const s = entry.sessionsSynced ?? 0;
  if (p === 0 && s === 0) return null;
  return `progress: ${p} book${p === 1 ? "" : "s"}${s > 0 ? `, ${s} session${s === 1 ? "" : "s"}` : ""}`;
}

function summarize(entry: SyncCycleResult): {
  icon: "download" | "new" | "progress" | "warning" | "error" | "ok";
  text: string;
} {
  const prog = progressText(entry);
  if (entry.downloaded.length > 0) {
    return {
      icon: "download",
      text: `Downloaded ${titles(entry.downloaded)}${
        entry.absLibrariesScanned.length > 0 ? " → ABS updated" : ""
      }${prog ? ` · ${prog}` : ""}`,
    };
  }
  if (entry.newBooks.length > 0) {
    return { icon: "new", text: `Found new purchase: ${titles(entry.newBooks)}` };
  }
  if (prog) {
    return { icon: "progress", text: `Synced listening ${prog}` };
  }
  if (entry.nestingWarnings.length > 0) {
    return { icon: "warning", text: entry.nestingWarnings[0] };
  }
  if (entry.errors.length > 0) {
    return { icon: "error", text: entry.errors[0] };
  }
  return { icon: "ok", text: "Checked — nothing new" };
}

const ENTRY_ICONS = {
  download: <Download className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />,
  new: <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-500" />,
  progress: <Headphones className="h-3.5 w-3.5 text-blue-600 dark:text-blue-500" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" />,
  error: <CircleAlert className="h-3.5 w-3.5 text-destructive" />,
  ok: <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />,
};

export function AutoSyncCard() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const waitingRef = useRef(false);

  const load = useCallback(async (): Promise<SyncStatus | null> => {
    try {
      const res = await fetch("/api/sync");
      const json = await res.json();
      if (json.ok) {
        setStatus(json.data);
        return json.data;
      }
    } catch {
      // dashboard still renders without sync status
    }
    return null;
  }, []);

  // Poll: fast while a cycle is running, relaxed otherwise
  useEffect(() => {
    load();
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const s = await load();
      if (!active) return;
      const busy = s?.cycleRunning || waitingRef.current;
      if (waitingRef.current && s && !s.cycleRunning) {
        waitingRef.current = false;
        setSyncing(false);
        if (s.lastResult) toastResult(s.lastResult);
      }
      timer = setTimeout(poll, busy ? 3000 : 15000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load]);

  function toastResult(result: SyncCycleResult) {
    if (result.skipped === "libation-busy") {
      toast.info("Libation is busy with another task — will retry on schedule");
    } else if (result.skipped === "cycle-in-progress") {
      toast.info("A sync is already running");
    } else if (result.downloaded.length > 0) {
      toast.success(`Downloaded ${titles(result.downloaded)} — ABS updated`);
    } else if (result.errors.length > 0) {
      toast.error(result.errors[0]);
    } else if (result.newBooks.length > 0) {
      toast.success(`Found new purchase: ${titles(result.newBooks)}`);
    } else if (progressText(result)) {
      toast.success(`Synced listening ${progressText(result)}`);
    } else {
      toast.success("Up to date — no new purchases");
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "Sync failed");
        setSyncing(false);
        return;
      }
      if (json.data.running) {
        // Long cycle (downloading) — the poll loop will toast when done
        waitingRef.current = true;
        toast.info("Sync running in the background");
        load();
      } else {
        setSyncing(false);
        if (json.data.result) toastResult(json.data.result);
        load();
      }
    } catch {
      toast.error("Sync failed");
      setSyncing(false);
    }
  }

  async function saveSettings(partial: { enabled?: boolean; intervalMinutes?: number }) {
    try {
      const res = await fetch("/api/sync/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const json = await res.json();
      if (json.ok) {
        load();
        if (partial.enabled !== undefined) {
          toast.success(partial.enabled ? "Auto-sync enabled" : "Auto-sync disabled");
        }
      } else {
        toast.error(json.error || "Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    }
  }

  const enabled = status?.settings.enabled ?? false;
  const running = status?.cycleRunning || syncing;
  const lastDownload = status?.activity.find((a) => a.downloaded.length > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Auto-Sync</CardTitle>
          {running ? (
            <Badge variant="secondary">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Syncing
            </Badge>
          ) : (
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? "Active" : "Off"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={String(status?.settings.intervalMinutes ?? 10)}
            onValueChange={(v) => v && saveSettings({ intervalMinutes: Number(v) })}
          >
            <SelectTrigger size="sm" disabled={!status}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVALS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  every {m}m
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Switch
            checked={enabled}
            disabled={!status}
            onCheckedChange={(checked) => saveSettings({ enabled: checked })}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Watches Audible for new purchases, downloads them with Libation, and
          updates Audiobookshelf automatically.
        </p>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Last check</p>
            <p className="font-medium">{relTime(status?.lastRunAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Next check</p>
            <p className="font-medium">
              {enabled ? relTime(status?.nextRunAt) : "--"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Last download</p>
            <p className="truncate font-medium" title={lastDownload ? titles(lastDownload.downloaded, 99) : undefined}>
              {lastDownload ? titles(lastDownload.downloaded, 1) : "--"}
            </p>
          </div>
        </div>

        {status && status.activity.length > 0 && (
          <div className="space-y-1.5 border-t pt-2">
            {status.activity.slice(0, 5).map((entry) => {
              const { icon, text } = summarize(entry);
              return (
                <div key={entry.id} className="flex items-center gap-2 text-xs">
                  {ENTRY_ICONS[icon]}
                  <span className="min-w-0 flex-1 truncate" title={text}>
                    {text}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {relTime(entry.finishedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end border-t pt-2">
          <Button size="sm" variant="outline" onClick={handleSyncNow} disabled={running || !status}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}
            Sync Now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
