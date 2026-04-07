import type { ABSUser, ABSLibrary, ABSLibraryItem } from "./types";

export class ABSClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ABS ${method} ${path} failed (${res.status}): ${text}`);
    }

    if (res.status === 204) {
      return {} as T;
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json() as Promise<T>;
    }

    // Some ABS endpoints return empty or non-JSON
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  async me(): Promise<ABSUser> {
    return this.request<ABSUser>("GET", "/api/me");
  }

  async libraries(): Promise<ABSLibrary[]> {
    const res = await this.request<{ libraries: ABSLibrary[] }>(
      "GET",
      "/api/libraries"
    );
    return res.libraries;
  }

  async libraryItems(libraryId: string): Promise<ABSLibraryItem[]> {
    const res = await this.request<{ results: ABSLibraryItem[] }>(
      "GET",
      `/api/libraries/${libraryId}/items`,
      undefined,
      { limit: "0", minified: "1" }
    );
    return res.results;
  }

  async syncSessions(sessions: unknown[]): Promise<unknown> {
    return this.request("POST", "/api/session/local-all", sessions);
  }

  async updateProgress(updates: unknown[]): Promise<unknown> {
    return this.request("PATCH", "/api/me/progress/batch/update", updates);
  }

  async getItem(itemId: string): Promise<ABSLibraryItem> {
    return this.request<ABSLibraryItem>("GET", `/api/items/${itemId}`);
  }

  async scanLibrary(libraryId: string): Promise<void> {
    await this.request("POST", `/api/libraries/${libraryId}/scan`);
  }

  async getCoverUrl(itemId: string): Promise<string> {
    return `${this.baseUrl}/api/items/${itemId}/cover`;
  }

  /** Stream cover image as raw response for proxying */
  async getCover(itemId: string): Promise<Response> {
    return fetch(`${this.baseUrl}/api/items/${itemId}/cover`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }
}

/** Create an ABSClient from environment variables + optional user override */
export function createABSClient(user?: string): ABSClient {
  const url = process.env.ABS_URL;
  if (!url) throw new Error("ABS_URL not configured");

  let token: string | undefined;
  if (user) {
    token = process.env[`ABS_TOKEN_${user.toUpperCase()}`];
  }
  token = token || process.env.ABS_TOKEN;
  if (!token) throw new Error("No ABS token configured");

  return new ABSClient(url, token);
}
