"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History, FileText } from "lucide-react";

interface Report {
  id: string;
  timestamp: string;
  sessionsOk?: number;
  sessionsFailed?: number;
  progressOk?: number;
  matchedCount?: number;
  unmatchedCount?: number;
}

export default function HistoryPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reports")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setReports(json.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Import History</h1>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <History className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold">No Imports Yet</h2>
            <p className="text-sm text-muted-foreground max-w-md mt-2">
              Import reports will appear here after you run your first listening
              stats import.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <Card key={report.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(report.timestamp).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {report.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {report.sessionsOk != null && (
                      <Badge variant="default">
                        {report.sessionsOk} sessions
                      </Badge>
                    )}
                    {report.matchedCount != null && (
                      <Badge variant="secondary">
                        {report.matchedCount} matched
                      </Badge>
                    )}
                    {(report.sessionsFailed ?? 0) > 0 && (
                      <Badge variant="destructive">
                        {report.sessionsFailed} failed
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
