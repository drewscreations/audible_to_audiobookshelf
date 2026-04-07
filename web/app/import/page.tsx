"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload,
  FileText,
  CheckCircle,
  XCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import { aggregateAudibleListening, type ParseResult } from "@/lib/csv-parser";
import type { ABSLibrary, AudibleAggregateDay } from "@/lib/types";

type Step = "upload" | "summary" | "matching" | "sync" | "results";

interface MatchData {
  matches: Record<string, { itemId: string; libraryId: string; title: string; authorName: string; duration: number }>;
  unmatched: string[];
  matchedCount: number;
  unmatchedCount: number;
}

interface SyncResults {
  sessionsOk: number;
  sessionsFailed: number;
  progressOk: number;
  progressFailed: number;
}

export default function ImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [sinceDate, setSinceDate] = useState("");
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [libraries, setLibraries] = useState<ABSLibrary[]>([]);
  const [matching, setMatching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [syncResults, setSyncResults] = useState<SyncResults | null>(null);
  const [includeProgress, setIncludeProgress] = useState(true);
  const [dryRun, setDryRun] = useState(false);

  // Load libraries on mount
  useEffect(() => {
    fetch("/api/abs/libraries")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setLibraries(json.data);
      });
  }, []);

  // Handle file drop/selection
  const handleFile = useCallback(
    (f: File) => {
      setFile(f);
      setSyncLog([]);
      setSyncResults(null);

      Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const parsed = aggregateAudibleListening(
              results.data as Record<string, string>[],
              results.meta.fields || [],
              sinceDate || undefined
            );
            setParseResult(parsed);
            setStep("summary");
            toast.success(
              `Parsed ${parsed.stats.rowsAggregated} day-rows from ${parsed.stats.uniqueAsins} ASINs`
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Parse failed";
            toast.error(msg);
          }
        },
        error: (err) => {
          toast.error(`CSV parse error: ${err.message}`);
        },
      });
    },
    [sinceDate]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f && f.name.endsWith(".csv")) handleFile(f);
    },
    [handleFile]
  );

  // Re-parse with date filter
  const reParse = useCallback(() => {
    if (file) handleFile(file);
  }, [file, handleFile]);

  // ASIN matching
  async function runMatching() {
    if (!parseResult) return;
    setMatching(true);

    try {
      const uniqueAsins = [...new Set(parseResult.days.map((d) => d.asin))];
      const libraryIds = libraries
        .filter((l) => l.mediaType === "book")
        .map((l) => l.id);

      const res = await fetch("/api/abs/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asins: uniqueAsins, libraryIds }),
      });
      const json = await res.json();
      if (json.ok) {
        setMatchData(json.data);
        setStep("matching");
      } else {
        toast.error(json.error || "Matching failed");
      }
    } catch {
      toast.error("Matching failed");
    } finally {
      setMatching(false);
    }
  }

  // Sync execution
  async function runSync() {
    if (!parseResult || !matchData) return;
    setSyncing(true);
    setSyncProgress(0);
    setSyncLog([]);

    const log = (msg: string) =>
      setSyncLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    if (dryRun) {
      log("Dry run mode — no data will be sent to ABS");
      setSyncResults({
        sessionsOk: 0,
        sessionsFailed: 0,
        progressOk: 0,
        progressFailed: 0,
      });
      setStep("results");
      setSyncing(false);
      return;
    }

    try {
      // Get user ID
      const meRes = await fetch("/api/abs/me");
      const me = await meRes.json();
      if (!me.ok) throw new Error("Could not get ABS user");
      const userId = me.data.id;
      log(`Connected as ${me.data.username} (${userId})`);

      // Build sessions using the session-builder lib (imported dynamically to keep client bundle small)
      const { buildSessions, buildProgressUpdates, chunked } = await import(
        "@/lib/session-builder"
      );

      // Reconstruct matched pairs from parseResult + matchData
      const matchedPairs: Array<{
        day: AudibleAggregateDay;
        item: { id: string; libraryId: string; media: { metadata: { title: string; authorName: string }; duration: number; coverPath: string } };
      }> = [];

      for (const day of parseResult.days) {
        const match = matchData.matches[day.asin];
        if (match) {
          matchedPairs.push({
            day,
            item: {
              id: match.itemId,
              libraryId: match.libraryId,
              media: {
                metadata: {
                  title: match.title,
                  authorName: match.authorName,
                },
                duration: match.duration,
                coverPath: "",
              },
            },
          });
        }
      }

      log(`Building ${matchedPairs.length} sessions...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessions = buildSessions(matchedPairs as any, userId);
      const batches = chunked(sessions, 250);
      log(`Syncing ${sessions.length} sessions in ${batches.length} batches...`);

      let sessionsOk = 0;
      let sessionsFailed = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const res = await fetch("/api/abs/sync/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessions: batch }),
        });
        const json = await res.json();
        if (json.ok) {
          const results = json.data?.results || [];
          const ok = results.filter((r: { success: boolean }) => r.success).length;
          const fail = results.filter((r: { success: boolean }) => !r.success).length;
          sessionsOk += ok;
          sessionsFailed += fail;
          log(`Batch ${i + 1}/${batches.length}: ${ok} ok, ${fail} failed`);
        } else {
          sessionsFailed += batch.length;
          log(`Batch ${i + 1}/${batches.length}: ERROR - ${json.error}`);
        }
        setSyncProgress(((i + 1) / batches.length) * (includeProgress ? 70 : 100));
      }

      let progressOk = 0;
      let progressFailed = 0;

      if (includeProgress) {
        log("Building progress updates...");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updates = buildProgressUpdates(matchedPairs as any);
        const progressBatches = chunked(updates, 200);
        log(
          `Updating progress for ${updates.length} items in ${progressBatches.length} batches...`
        );

        for (let i = 0; i < progressBatches.length; i++) {
          const batch = progressBatches[i];
          const res = await fetch("/api/abs/sync/progress", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: batch }),
          });
          const json = await res.json();
          if (json.ok) {
            progressOk += batch.length;
            log(`Progress batch ${i + 1}/${progressBatches.length}: ${batch.length} updated`);
          } else {
            progressFailed += batch.length;
            log(
              `Progress batch ${i + 1}/${progressBatches.length}: ERROR - ${json.error}`
            );
          }
          setSyncProgress(70 + ((i + 1) / progressBatches.length) * 30);
        }
      }

      setSyncResults({ sessionsOk, sessionsFailed, progressOk, progressFailed });
      setSyncProgress(100);
      setStep("results");
      log("Sync complete!");
      toast.success("Import complete");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sync failed";
      log(`ERROR: ${msg}`);
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Import Listening Stats</h1>

      {/* Step indicators */}
      <div className="flex items-center gap-2 text-sm">
        {(["upload", "summary", "matching", "sync", "results"] as Step[]).map(
          (s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && (
                <div className="h-px w-6 bg-border" />
              )}
              <Badge
                variant={step === s ? "default" : "outline"}
                className="capitalize"
              >
                {i + 1}. {s}
              </Badge>
            </div>
          )
        )}
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <Card>
          <CardContent className="p-8">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-12 text-center hover:border-muted-foreground/50 transition-colors cursor-pointer"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".csv";
                input.onchange = (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) handleFile(f);
                };
                input.click();
              }}
            >
              <Upload className="h-12 w-12 text-muted-foreground mb-4" />
              <h2 className="text-lg font-semibold">
                Drop Listening.csv here
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-md">
                Export your listening data from Amazon&apos;s privacy portal, then
                drag and drop the CSV here.
              </p>
              {file && (
                <div className="mt-4 flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4" />
                  {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Label htmlFor="since" className="whitespace-nowrap">
                Since date:
              </Label>
              <Input
                id="since"
                type="date"
                value={sinceDate}
                onChange={(e) => setSinceDate(e.target.value)}
                className="max-w-48"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Parse Summary */}
      {step === "summary" && parseResult && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">
                  {parseResult.stats.rowsRead.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">CSV rows</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">
                  {parseResult.stats.rowsAggregated.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">Day-rows</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">
                  {parseResult.stats.uniqueAsins}
                </div>
                <p className="text-xs text-muted-foreground">Unique ASINs</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">
                  {parseResult.stats.deduped.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">Deduped</p>
              </CardContent>
            </Card>
          </div>

          {parseResult.stats.dateRange && (
            <p className="text-sm text-muted-foreground">
              Date range: {parseResult.stats.dateRange.first} to{" "}
              {parseResult.stats.dateRange.last}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Label htmlFor="since2" className="whitespace-nowrap">
              Filter since:
            </Label>
            <Input
              id="since2"
              type="date"
              value={sinceDate}
              onChange={(e) => setSinceDate(e.target.value)}
              className="max-w-48"
            />
            <Button variant="outline" size="sm" onClick={reParse}>
              Re-parse
            </Button>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("upload")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={runMatching} disabled={matching}>
              {matching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              Match ASINs
            </Button>
          </div>
        </>
      )}

      {/* Step 3: Matching Preview */}
      {step === "matching" && matchData && parseResult && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <CheckCircle className="h-6 w-6 text-green-500" />
                <div>
                  <div className="text-xl font-bold">
                    {matchData.matchedCount}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Matched ASINs
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <XCircle className="h-6 w-6 text-yellow-500" />
                <div>
                  <div className="text-xl font-bold">
                    {matchData.unmatchedCount}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Unmatched ASINs
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {matchData.unmatched.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Unmatched ASINs (first 20)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-40">
                  <div className="flex flex-wrap gap-1.5">
                    {matchData.unmatched.slice(0, 20).map((asin) => {
                      const day = parseResult.days.find(
                        (d) => d.asin === asin
                      );
                      return (
                        <Badge
                          key={asin}
                          variant="outline"
                          className="text-xs"
                          title={day?.title}
                        >
                          {asin}
                        </Badge>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Sync options */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Sync Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={includeProgress}
                  onCheckedChange={setIncludeProgress}
                />
                <Label>Update listening progress</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={dryRun} onCheckedChange={setDryRun} />
                <Label>Dry run (no data sent)</Label>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("summary")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={runSync} disabled={syncing}>
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {dryRun ? "Dry Run" : "Start Sync"}
            </Button>
          </div>
        </>
      )}

      {/* Step 4: Sync Progress (shown during sync) */}
      {(step === "matching" || step === "results") && syncing && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Syncing...</span>
              <span className="text-sm text-muted-foreground">
                {Math.round(syncProgress)}%
              </span>
            </div>
            <Progress value={syncProgress} />
          </CardContent>
        </Card>
      )}

      {/* Sync Log (shown during and after sync) */}
      {syncLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sync Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">
                {syncLog.join("\n")}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Results */}
      {step === "results" && syncResults && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-500">
                  {syncResults.sessionsOk}
                </div>
                <p className="text-xs text-muted-foreground">Sessions synced</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-500">
                  {syncResults.sessionsFailed}
                </div>
                <p className="text-xs text-muted-foreground">Sessions failed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-500">
                  {syncResults.progressOk}
                </div>
                <p className="text-xs text-muted-foreground">
                  Progress updated
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-500">
                  {syncResults.progressFailed}
                </div>
                <p className="text-xs text-muted-foreground">
                  Progress failed
                </p>
              </CardContent>
            </Card>
          </div>

          <Button variant="outline" onClick={() => { setStep("upload"); setFile(null); setParseResult(null); setMatchData(null); setSyncLog([]); setSyncResults(null); }}>
            Start New Import
          </Button>
        </>
      )}
    </div>
  );
}
