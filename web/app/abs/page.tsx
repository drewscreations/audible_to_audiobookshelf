"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import type { ABSLibrary } from "@/lib/types";

export default function ABSLibrariesPage() {
  const [libraries, setLibraries] = useState<ABSLibrary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/abs/libraries")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setLibraries(json.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ABS Libraries</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {libraries.map((lib) => (
          <Link key={lib.id} href={`/abs/${lib.id}`}>
            <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{lib.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {lib.stats?.totalItems || 0} items
                    </p>
                  </div>
                  <Badge variant="secondary">{lib.mediaType}</Badge>
                </div>
                {lib.folders.map((f) => (
                  <p key={f.id} className="mt-2 text-xs text-muted-foreground truncate">
                    {f.fullPath}
                  </p>
                ))}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
