"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Headphones,
  Download,
  CheckCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { LibationBook } from "@/lib/types";

type FilterStatus = "all" | "downloaded" | "not_downloaded";

export default function AudibleLibraryPage() {
  const [books, setBooks] = useState<LibationBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/libation/library")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setBooks(json.data);
        } else {
          setError(json.error);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return books.filter((book) => {
      // Status filter
      if (statusFilter === "downloaded" && !book.isDownloaded) return false;
      if (statusFilter === "not_downloaded" && book.isDownloaded) return false;

      // Search filter
      if (search) {
        const q = search.toLowerCase();
        return (
          book.title.toLowerCase().includes(q) ||
          book.authors.toLowerCase().includes(q) ||
          book.narrators.toLowerCase().includes(q) ||
          book.asin.toLowerCase().includes(q) ||
          (book.seriesName && book.seriesName.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [books, search, statusFilter]);

  const stats = useMemo(() => {
    const total = books.length;
    const downloaded = books.filter((b) => b.isDownloaded).length;
    return { total, downloaded, notDownloaded: total - downloaded };
  }, [books]);

  async function handleDownload(asin: string) {
    setDownloading(asin);
    try {
      const res = await fetch("/api/libation/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("Download started");
      } else {
        toast.error(json.error || "Download failed");
      }
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloading(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-4">
          <Skeleton className="h-10 flex-1 max-w-sm" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Audible Library</h1>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Headphones className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold">Libation Not Available</h2>
            <p className="text-sm text-muted-foreground max-w-md mt-2">
              {error}
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              Set up Libation in the{" "}
              <a href="/libation" className="underline">
                Libation page
              </a>{" "}
              to browse your Audible library.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audible Library</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} books &middot; {stats.downloaded} downloaded &middot;{" "}
            {stats.notDownloaded} pending
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by title, author, narrator, ASIN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter((v || "all") as FilterStatus)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({stats.total})</SelectItem>
            <SelectItem value="downloaded">
              Downloaded ({stats.downloaded})
            </SelectItem>
            <SelectItem value="not_downloaded">
              Not Downloaded ({stats.notDownloaded})
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Book List */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((book) => (
          <Card key={book.asin} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <h3 className="text-sm font-semibold leading-tight line-clamp-2 flex-1">
                      {book.title}
                    </h3>
                    {book.isDownloaded ? (
                      <CheckCircle className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                    ) : (
                      <Clock className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {book.authors}
                  </p>
                  {book.narrators !== "Unknown" && (
                    <p className="text-xs text-muted-foreground">
                      Narrated by {book.narrators}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {book.seriesName && (
                      <Badge variant="outline" className="text-[10px]">
                        {book.seriesName}
                        {book.seriesOrder ? ` #${book.seriesOrder}` : ""}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">
                      {book.asin}
                    </Badge>
                    {book.lengthInMinutes && (
                      <Badge variant="secondary" className="text-[10px]">
                        {Math.floor(book.lengthInMinutes / 60)}h{" "}
                        {book.lengthInMinutes % 60}m
                      </Badge>
                    )}
                  </div>
                </div>
                {!book.isDownloaded && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 self-center"
                    onClick={() => handleDownload(book.asin)}
                    disabled={downloading === book.asin}
                  >
                    {downloading === book.asin ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-muted-foreground py-12">
          {search
            ? "No books match your search"
            : "No books found in this category"}
        </p>
      )}
    </div>
  );
}
