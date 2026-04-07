"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ABSLibraryItem, ABSLibrary } from "@/lib/types";

export default function ABSLibraryDetailPage() {
  const { libraryId } = useParams<{ libraryId: string }>();
  const [items, setItems] = useState<ABSLibraryItem[]>([]);
  const [libraries, setLibraries] = useState<ABSLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [movingItem, setMovingItem] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/abs/libraries/${libraryId}/items`).then((r) => r.json()),
      fetch("/api/abs/libraries").then((r) => r.json()),
    ])
      .then(([itemsJson, libsJson]) => {
        if (itemsJson.ok) setItems(itemsJson.data);
        if (libsJson.ok) setLibraries(libsJson.data);
      })
      .finally(() => setLoading(false));
  }, [libraryId]);

  const currentLibrary = libraries.find((l) => l.id === libraryId);
  const otherLibraries = libraries.filter(
    (l) => l.id !== libraryId && l.mediaType === "book"
  );

  async function handleMove(itemId: string, targetLibraryId: string) {
    const item = items.find((i) => i.id === itemId);
    const targetLib = libraries.find((l) => l.id === targetLibraryId);
    if (!item || !targetLib) return;

    setMovingItem(itemId);
    try {
      const res = await fetch(`/api/abs/items/${itemId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLibraryId }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(
          `Moved "${item.media.metadata.title}" to ${targetLib.name}`
        );
        // Remove from current list
        setItems((prev) => prev.filter((i) => i.id !== itemId));
      } else {
        toast.error(json.error || "Move failed");
      }
    } catch {
      toast.error("Move failed");
    } finally {
      setMovingItem(null);
    }
  }

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    const meta = item.media.metadata;
    return (
      meta.title?.toLowerCase().includes(q) ||
      meta.authorName?.toLowerCase().includes(q) ||
      meta.asin?.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full max-w-sm" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {currentLibrary?.name || "Library"}{" "}
          <span className="text-muted-foreground">({items.length} items)</span>
        </h1>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by title, author, or ASIN..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {filtered.map((item) => (
          <div key={item.id} className="group space-y-2">
            <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/abs/items/${item.id}/cover`}
                alt={item.media.metadata.title}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
              {item.media.metadata.asin && (
                <Badge
                  variant="secondary"
                  className="absolute bottom-1 right-1 text-[10px] opacity-80"
                >
                  {item.media.metadata.asin}
                </Badge>
              )}
              {/* Move button overlay */}
              {otherLibraries.length > 0 && (
                <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {otherLibraries.length === 1 ? (
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-7 w-7 shadow-md"
                      onClick={() =>
                        handleMove(item.id, otherLibraries[0].id)
                      }
                      disabled={movingItem === item.id}
                      title={`Move to ${otherLibraries[0].name}`}
                    >
                      {movingItem === item.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow-md hover:bg-secondary/80 disabled:opacity-50"
                        disabled={movingItem === item.id}
                      >
                        {movingItem === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                        )}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {otherLibraries.map((lib) => (
                          <DropdownMenuItem
                            key={lib.id}
                            onClick={() => handleMove(item.id, lib.id)}
                          >
                            Move to {lib.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-medium leading-tight line-clamp-2">
                {item.media.metadata.title}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-1">
                {item.media.metadata.authorName}
              </p>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && !loading && (
        <p className="text-center text-muted-foreground py-12">
          {search ? "No items match your search" : "No items in this library"}
        </p>
      )}
    </div>
  );
}
