"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Headphones,
  Library,
  Download,
  RefreshCw,
  BookOpen,
  ArrowRight,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type { ABSLibrary } from "@/lib/types";

interface DashboardData {
  absConnected: boolean;
  absUsername?: string;
  libraries: ABSLibrary[];
  totalItems: number;
  libation: {
    containerRunning: boolean;
    dbAvailable: boolean;
    totalBooks: number | null;
    downloadedBooks: number | null;
    notDownloaded: number | null;
  } | null;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  async function load() {
    try {
      const [meRes, libRes, libationRes] = await Promise.all([
        fetch("/api/abs/me"),
        fetch("/api/abs/libraries"),
        fetch("/api/libation/status"),
      ]);
      const me = await meRes.json();
      const libs = await libRes.json();
      const libation = await libationRes.json();

      const libraries: ABSLibrary[] = libs.ok ? libs.data : [];
      const totalItems = libraries.reduce(
        (sum, l) => sum + (l.stats?.totalItems || 0),
        0
      );

      setData({
        absConnected: me.ok,
        absUsername: me.data?.username,
        libraries,
        totalItems,
        libation: libation.ok ? libation.data : null,
      });
    } catch {
      setData({
        absConnected: false,
        libraries: [],
        totalItems: 0,
        libation: null,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch("/api/libation/scan", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        toast.success("Scan completed");
        load();
      } else {
        toast.error(json.error || "Scan failed");
      }
    } catch {
      toast.error("Scan failed");
    } finally {
      setScanning(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const lib = data?.libation;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {data?.absConnected
              ? `Connected to ABS as ${data.absUsername}`
              : "Not connected to Audiobookshelf"}
          </p>
        </div>
        <div className="flex gap-2">
          {lib?.containerRunning && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleScan}
              disabled={scanning}
            >
              {scanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Scan Audible
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(); }}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">ABS Status</CardTitle>
            <Library className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant={data?.absConnected ? "default" : "destructive"}>
              {data?.absConnected ? "Connected" : "Disconnected"}
            </Badge>
            {data?.absConnected && (
              <p className="mt-1 text-xs text-muted-foreground">
                {data.libraries.length} libraries
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Books in ABS</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.totalItems || 0}</div>
            <p className="text-xs text-muted-foreground">
              across {data?.libraries.length || 0} libraries
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Audible Books</CardTitle>
            <Headphones className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {lib?.totalBooks ?? "--"}
            </div>
            <p className="text-xs text-muted-foreground">
              {lib?.dbAvailable
                ? `${lib.downloadedBooks ?? 0} downloaded`
                : "Set up Libation to scan"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">To Download</CardTitle>
            <Download className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {lib?.notDownloaded ?? "--"}
            </div>
            <p className="text-xs text-muted-foreground">
              {lib?.containerRunning
                ? "Libation container running"
                : "Awaiting Libation setup"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="hover:bg-accent/50 transition-colors">
          <Link href="/library" className="block p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Audible Library</h3>
                <p className="text-sm text-muted-foreground">
                  Browse your Audible books and download new titles
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </Link>
        </Card>

        <Card className="hover:bg-accent/50 transition-colors">
          <Link href="/abs" className="block p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">ABS Library</h3>
                <p className="text-sm text-muted-foreground">
                  Browse your Audiobookshelf collection
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </Link>
        </Card>

        <Card className="hover:bg-accent/50 transition-colors">
          <Link href="/libation" className="block p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Libation</h3>
                <p className="text-sm text-muted-foreground">
                  Scan and download audiobooks from Audible
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </Link>
        </Card>
      </div>

      {/* Libraries Overview */}
      {data?.libraries && data.libraries.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">ABS Libraries</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.libraries.map((lib) => (
              <Link key={lib.id} href={`/abs/${lib.id}`}>
                <Card className="hover:bg-accent/50 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium">{lib.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {lib.stats?.totalItems || 0} items
                        </p>
                      </div>
                      <Badge variant="secondary">{lib.mediaType}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
