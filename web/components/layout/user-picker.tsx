"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User } from "lucide-react";

export function UserPicker() {
  const [users, setUsers] = useState<string[]>([]);
  const [activeUser, setActiveUser] = useState<string>("");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data) {
          setUsers(json.data.tokenUsers || []);
          setActiveUser(json.data.activeUser || "");
        }
      })
      .catch(() => {});
  }, []);

  async function handleChange(value: string | null) {
    if (!value) return;
    setActiveUser(value);
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeUser: value }),
    });
    // Reload to refresh connection badge
    window.location.reload();
  }

  if (users.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <User className="h-4 w-4 text-muted-foreground" />
      <Select value={activeUser} onValueChange={handleChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select user" />
        </SelectTrigger>
        <SelectContent>
          {users.map((u) => (
            <SelectItem key={u} value={u}>
              {u.charAt(0).toUpperCase() + u.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
