"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface AudibleAccountInfo {
  accountId: string;
  accountName: string;
  locale: string;
}

export default function SettingsPage() {
  const [absUrl, setAbsUrl] = useState("");
  const [activeUser, setActiveUser] = useState("");
  const [tokenUsers, setTokenUsers] = useState<string[]>([]);
  const [libraries, setLibraries] = useState<
    { id: string; name: string; selected: boolean }[]
  >([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  // Listening progress sync
  const [syncProgress, setSyncProgress] = useState(true);
  const [audibleAccounts, setAudibleAccounts] = useState<AudibleAccountInfo[]>([]);
  const [accountMap, setAccountMap] = useState<Record<string, string>>({});
  const [progressInfo, setProgressInfo] = useState<"loading" | "ok" | "fail">("loading");
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunLines, setDryRunLines] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data) {
          setAbsUrl(json.data.absUrl || "");
          setActiveUser(json.data.activeUser || "");
          setTokenUsers(json.data.tokenUsers || []);
        }
      });
    fetch("/api/sync/progress")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data) {
          setAudibleAccounts(json.data.accounts || []);
          setAccountMap(json.data.accountMap || {});
          setSyncProgress(json.data.syncProgress !== false);
          setProgressInfo("ok");
        } else {
          setProgressInfo("fail");
        }
      })
      .catch(() => setProgressInfo("fail"));
  }, []);

  async function saveProgressSettings(next?: { syncProgress?: boolean }) {
    const body = {
      syncProgress: next?.syncProgress ?? syncProgress,
      accountMap,
    };
    try {
      const res = await fetch("/api/sync/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("Progress sync settings saved");
      } else {
        toast.error(json.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    }
  }

  async function runDryRun() {
    setDryRunning(true);
    setDryRunLines([]);
    try {
      const res = await fetch("/api/sync/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "Dry run failed");
        return;
      }
      const lines: string[] = [];
      for (const acct of json.data.accounts || []) {
        if (acct.skipped) {
          lines.push(`${acct.accountName}: ${acct.skipped}`);
          continue;
        }
        lines.push(
          `${acct.accountName} → ${acct.absUser}: ${acct.progressUpdated} progress update(s), ${acct.sessionsSynced} session(s) from ${acct.matchedBooks} matched book(s)` +
            (typeof acct.todayListeningMin === "number"
              ? ` — ${acct.todayListeningMin} min listened today`
              : "")
        );
        for (const ex of acct.examples || []) lines.push(`   ${ex}`);
        for (const err of acct.errors || []) lines.push(`   ⚠ ${err}`);
      }
      for (const err of json.data.errors || []) {
        if (!lines.some((l) => l.includes(err))) lines.push(`⚠ ${err}`);
      }
      setDryRunLines(lines.length > 0 ? lines : ["Nothing to sync"]);
      toast.success("Dry run complete — nothing was written");
    } catch {
      toast.error("Dry run failed");
    } finally {
      setDryRunning(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/abs/me");
      const json = await res.json();
      if (json.ok) {
        setTestResult("ok");
        toast.success(`Connected as ${json.data.username}`);
        // Also load libraries
        const libRes = await fetch("/api/abs/libraries");
        const libJson = await libRes.json();
        if (libJson.ok) {
          setLibraries(
            libJson.data.map((l: { id: string; name: string }) => ({
              id: l.id,
              name: l.name,
              selected: true,
            }))
          );
        }
      } else {
        setTestResult("fail");
        toast.error(json.error || "Connection failed");
      }
    } catch {
      setTestResult("fail");
      toast.error("Connection failed");
    } finally {
      setTesting(false);
    }
  }

  async function saveSettings() {
    const selectedLibs = libraries.filter((l) => l.selected).map((l) => l.id);
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        absUrl,
        activeUser,
        libraries: selectedLibs,
      }),
    });
    toast.success("Settings saved");
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Audiobookshelf Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="abs-url">ABS URL</Label>
            <Input
              id="abs-url"
              value={absUrl}
              onChange={(e) => setAbsUrl(e.target.value)}
              placeholder="http://100.96.84.62:13378"
            />
          </div>

          <div className="space-y-2">
            <Label>Active User</Label>
            <div className="flex flex-wrap gap-2">
              {tokenUsers.map((u) => (
                <Badge
                  key={u}
                  variant={u === activeUser ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setActiveUser(u)}
                >
                  {u.charAt(0).toUpperCase() + u.slice(1)}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={testConnection} disabled={testing}>
              {testing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Test Connection
            </Button>
            {testResult === "ok" && (
              <CheckCircle className="h-5 w-5 text-green-500" />
            )}
            {testResult === "fail" && (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Portainer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Portainer manages the Libation container on your NAS. Generate an API
            key in Portainer: My account &rarr; Access tokens.
          </p>
          <div className="space-y-2">
            <Label htmlFor="portainer-url">Portainer URL</Label>
            <Input
              id="portainer-url"
              defaultValue="http://100.96.84.62:19900"
              placeholder="http://100.96.84.62:19900"
              disabled
            />
            <p className="text-xs text-muted-foreground">
              Set via PORTAINER_URL environment variable
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="portainer-key">API Key</Label>
            <Input
              id="portainer-key"
              type="password"
              defaultValue=""
              placeholder="ptr_..."
              disabled
            />
            <p className="text-xs text-muted-foreground">
              Set via PORTAINER_API_KEY environment variable
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Listening Progress Sync</CardTitle>
          <Switch
            checked={syncProgress}
            onCheckedChange={(checked) => {
              setSyncProgress(checked);
              saveProgressSettings({ syncProgress: checked });
            }}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Each auto-sync cycle pulls listening positions from Audible and
            pushes them to Audiobookshelf — progress moves forward only, and
            listening sessions are recorded per day. Map each Audible account
            to the ABS user whose progress it should update.
          </p>

          {progressInfo === "loading" && (
            <p className="text-sm text-muted-foreground">Loading Audible accounts...</p>
          )}
          {progressInfo === "fail" && (
            <p className="text-sm text-destructive">
              Could not load Audible accounts (Portainer/Libation unreachable?)
            </p>
          )}

          {audibleAccounts.map((acct) => (
            <div key={acct.accountId} className="space-y-2">
              <Label>
                {acct.accountName}{" "}
                <span className="text-muted-foreground">({acct.locale})</span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {tokenUsers.map((u) => (
                  <Badge
                    key={u}
                    variant={accountMap[acct.accountId] === u ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() =>
                      setAccountMap((prev) => ({ ...prev, [acct.accountId]: u }))
                    }
                  >
                    {u.charAt(0).toUpperCase() + u.slice(1)}
                  </Badge>
                ))}
                {accountMap[acct.accountId] && (
                  <Badge
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() =>
                      setAccountMap((prev) => {
                        const next = { ...prev };
                        delete next[acct.accountId];
                        return next;
                      })
                    }
                  >
                    clear
                  </Badge>
                )}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => saveProgressSettings()}>
              Save Mapping
            </Button>
            <Button variant="outline" onClick={runDryRun} disabled={dryRunning}>
              {dryRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Test (dry run)
            </Button>
          </div>

          {dryRunLines.length > 0 && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {dryRunLines.join("\n")}
            </pre>
          )}
        </CardContent>
      </Card>

      {libraries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Libraries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {libraries.map((lib) => (
              <label
                key={lib.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={lib.selected}
                  onChange={(e) =>
                    setLibraries((prev) =>
                      prev.map((l) =>
                        l.id === lib.id
                          ? { ...l, selected: e.target.checked }
                          : l
                      )
                    )
                  }
                />
                {lib.name}
                <span className="text-muted-foreground">({lib.id.slice(0, 8)}...)</span>
              </label>
            ))}
          </CardContent>
        </Card>
      )}

      <Button onClick={saveSettings}>Save Settings</Button>
    </div>
  );
}
