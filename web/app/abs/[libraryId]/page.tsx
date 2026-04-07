"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import type { ABSLibraryItem } from "@/lib/types";

export default function ABSLibraryDetailPage() {
  const { libraryId } = useParams<{ libraryId: string }>();
  const [items, setItems] = useState<ABSLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`/api/abs/libraries/${libraryId}/items`)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setItems(json.data);
      })
      .finally(() => setLoading(false));
  }, [libraryId]);

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
          Library <span className="text-muted-foreground">({items.length} items)</span>
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
