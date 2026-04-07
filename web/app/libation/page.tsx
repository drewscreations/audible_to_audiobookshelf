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

export default function LibationPage() {
  const [status, setStatus] = useState<LibationStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [output, setOutput] = useState<string>("");

  async function loadStatus() {
    try {
      const res = await fetch("/api/libation/status");
      const json = await res.json();
      if (json.ok) setStatus(json.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

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
              disabled={scanning || !status?.containerRunning || !status?.portainerAvailable}
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
              disabled={downloading || !status?.containerRunning || !status?.portainerAvailable}
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
              Configure Portainer API key in Settings to manage the Libation container.
            </p>
          )}
          {status?.portainerAvailable && !status?.containerRunning && (
            <p className="text-sm text-muted-foreground">
              The Libation container is not running. Start it via{" "}
              <a
                href={`${process.env.NEXT_PUBLIC_PORTAINER_URL || "http://100.96.84.62:19900"}/#!/3/docker/stacks`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Portainer
              </a>{" "}
              or with{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                docker compose up -d libation
              </code>
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
              <p>
                2. Configure your Audible account in the Libation config
                directory
              </p>
              <p>
                3. Return here to scan your library and download books
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
