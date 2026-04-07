"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  RefreshCw,
  Download,
  Loader2,
  CheckCircle,
  XCircle,
  Terminal,
  Key,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

interface LibationStatusData {
  containerRunning: boolean;
  portainerAvailable: boolean;
  dbAvailable: boolean;
  totalBooks: number | null;
  downloadedBooks: number | null;
  notDownloaded: number | null;
}

interface AccountInfo {
  accountId: string;
  accountName: string;
  locale: string;
  tokenExpires: string;
  isExpired: boolean;
}

export default function LibationPage() {
  const [status, setStatus] = useState<LibationStatusData | null>(null);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [refreshingTokens, setRefreshingTokens] = useState(false);
  const [output, setOutput] = useState<string>("");

  async function loadStatus() {
    try {
      const [statusRes, authRes] = await Promise.all([
        fetch("/api/libation/status"),
        fetch("/api/libation/auth"),
      ]);
      const statusJson = await statusRes.json();
      const authJson = await authRes.json();
      if (statusJson.ok) setStatus(statusJson.data);
      if (authJson.ok) setAccounts(authJson.data.accounts || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleRefreshTokens() {
    setRefreshingTokens(true);
    try {
      const res = await fetch("/api/libation/auth", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        const { refreshed, failed } = json.data;
        if (refreshed.length > 0) {
          toast.success(
            `Refreshed ${refreshed.length} account(s). New expiry: ${new Date(refreshed[0].expires).toLocaleString()}`
          );
        }
        if (failed.length > 0) {
          toast.error(
            `Failed to refresh ${failed.length} account(s): ${failed[0].error}`
          );
        }
        loadStatus();
      } else {
        toast.error(json.error || "Token refresh failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error(msg);
    } finally {
      setRefreshingTokens(false);
    }
  }

  async function handleScan() {
    setScanning(true);
    setOutput("");
    try {
      const res = await fetch("/api/libation/scan", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        setOutput(json.data.stdout || json.data.stderr || "Scan completed");
        toast.success("Scan completed");
        loadStatus();
      } else {
        setOutput(json.error || "Scan failed");
        toast.error("Scan failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setOutput(msg);
      toast.error("Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setOutput("");
    try {
      const res = await fetch("/api/libation/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.ok) {
        setOutput(json.data.stdout || json.data.stderr || "Download completed");
        toast.success("Download completed");
        loadStatus();
      } else {
        setOutput(json.error || "Download failed");
        toast.error("Download failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setOutput(msg);
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Libation</h1>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking Libation status...
        </div>
      </div>
    );
  }

  const hasExpiredTokens = accounts.some((a) => a.isExpired);
  const canOperate =
    status?.containerRunning && status?.portainerAvailable;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Libation</h1>
        <Button variant="outline" size="sm" onClick={loadStatus}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Portainer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {status?.portainerAvailable ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-sm">Connected</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  <span className="text-sm">Not configured</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Container</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {status?.containerRunning ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-sm">Running</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  <span className="text-sm">Not running</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Database</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {status?.dbAvailable ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-sm">Available</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  <span className="text-sm">Not found</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Books</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.totalBooks ?? "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">To Download</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.notDownloaded ?? "--"}
            </div>
            {status?.downloadedBooks != null && (
              <p className="text-xs text-muted-foreground">
                {status.downloadedBooks} already downloaded
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audible Accounts / Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Audible Accounts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Audible accounts configured. Upload credentials or configure
              Libation with your Audible account.
            </p>
          ) : (
            <div className="space-y-3">
              {accounts.map((acct) => (
                <div
                  key={acct.accountId}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    {acct.isExpired ? (
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                    ) : (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{acct.accountName}</p>
                      <p className="text-xs text-muted-foreground">
                        Locale: {acct.locale}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={acct.isExpired ? "destructive" : "default"}
                    >
                      {acct.isExpired ? "Expired" : "Active"}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {acct.tokenExpires
                        ? `Expires: ${new Date(acct.tokenExpires).toLocaleString()}`
                        : "No expiry info"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasExpiredTokens && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Token expired</p>
                <p className="text-xs text-muted-foreground">
                  Click &quot;Refresh Tokens&quot; to automatically renew using the stored
                  refresh token. No desktop app needed.
                </p>
              </div>
            </div>
          )}

          <Button
            onClick={handleRefreshTokens}
            disabled={refreshingTokens || !canOperate || accounts.length === 0}
            variant={hasExpiredTokens ? "default" : "outline"}
          >
            {refreshingTokens ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Key className="mr-2 h-4 w-4" />
            )}
            Refresh Tokens
          </Button>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleScan}
              disabled={scanning || !canOperate}
            >
              {scanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Scan Audible
            </Button>

            <Button
              onClick={handleDownload}
              disabled={downloading || !canOperate}
              variant="secondary"
            >
              {downloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download All New
            </Button>
          </div>

          {!status?.portainerAvailable && (
            <p className="text-sm text-muted-foreground">
              Configure Portainer API key in Settings to manage the Libation
              container.
            </p>
          )}
          {status?.portainerAvailable && !status?.containerRunning && (
            <p className="text-sm text-muted-foreground">
              The Libation container is not running. Start it via Portainer or
              with{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                docker compose up -d libation
              </code>
            </p>
          )}

          {hasExpiredTokens && canOperate && (
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              Audible token is expired. Refresh tokens above before scanning.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Output Log */}
      {output && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Terminal className="h-4 w-4" />
              Output
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">
                {output}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Setup Instructions */}
      {!status?.dbAvailable && !status?.containerRunning && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold">Libation Setup Required</h2>
            <p className="text-sm text-muted-foreground max-w-md mt-2">
              Configure Libation in Docker to scan and download your Audible
              library.
            </p>
            <div className="mt-6 text-left text-sm text-muted-foreground space-y-2 max-w-lg">
              <p>
                1. Run{" "}
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                  docker compose up -d libation
                </code>
              </p>
              <p>2. Configure your Audible account credentials</p>
              <p>3. Return here to refresh tokens, scan, and download books</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
