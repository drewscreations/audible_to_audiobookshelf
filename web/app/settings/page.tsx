"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

export default function SettingsPage() {
  const [absUrl, setAbsUrl] = useState("");
  const [activeUser, setActiveUser] = useState("");
  const [tokenUsers, setTokenUsers] = useState<string[]>([]);
  const [libraries, setLibraries] = useState<
    { id: string; name: string; selected: boolean }[]
  >([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

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
  }, []);

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
