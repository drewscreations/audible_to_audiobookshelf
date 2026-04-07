/**
 * Manage Audible authentication for the Libation container.
 *
 * Uses Amazon's OAuth token refresh endpoint to renew expired access tokens
 * without needing the desktop Libation app.
 */

const AMAZON_TOKEN_URL = "https://api.amazon.com/auth/token";

interface AudibleTokens {
  LocaleName: string;
  ExistingAccessToken: { TokenValue: string; Expires: string };
  RefreshToken: { Value: string };
  PrivateKey: { Value: string };
  AdpToken: { Value: string };
  Cookies: unknown[];
  DeviceSerialNumber: string;
  DeviceType: string;
  AmazonAccountId: string;
  DeviceName: string;
  StoreAuthenticationCookie: string;
}

interface AccountsSettings {
  Accounts: Array<{
    AccountId: string;
    AccountName: string;
    LibraryScan: boolean;
    DecryptKey: string;
    IdentityTokens: AudibleTokens;
    MaskedLogEntry: string;
  }>;
  Cdm: unknown;
}

/**
 * Read AccountsSettings.json from the Libation container via Portainer.
 */
export async function readAccountsSettings(): Promise<AccountsSettings> {
  const { baseUrl, apiKey, endpointId } = getPortainerConfig();

  const containerId = await findLibationContainerId();

  // Use Docker archive API to download the file
  const res = await fetch(
    `${baseUrl}/api/endpoints/${endpointId}/docker/containers/${containerId}/archive?path=/config/AccountsSettings.json`,
    { headers: { "X-API-Key": apiKey } }
  );

  if (!res.ok) {
    throw new Error(`Failed to read AccountsSettings: ${res.status}`);
  }

  // Response is a tar archive — extract the JSON
  const tarBuffer = await res.arrayBuffer();
  const content = extractFileFromTar(new Uint8Array(tarBuffer));
  return JSON.parse(content);
}

/**
 * Write AccountsSettings.json to the Libation container via Portainer.
 */
export async function writeAccountsSettings(
  settings: AccountsSettings
): Promise<void> {
  const { baseUrl, apiKey, endpointId } = getPortainerConfig();
  const containerId = await findLibationContainerId();

  const content = JSON.stringify(settings, null, 2);
  const tarData = createTarWithFile("AccountsSettings.json", content);

  const res = await fetch(
    `${baseUrl}/api/endpoints/${endpointId}/docker/containers/${containerId}/archive?path=/config/`,
    {
      method: "PUT",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/x-tar",
      },
      body: Buffer.from(tarData),
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to write AccountsSettings: ${res.status}`);
  }
}

/**
 * Refresh the Audible access token using the refresh token.
 * Returns the new access token and expiration.
 */
export async function refreshAudibleToken(refreshToken: string): Promise<{
  accessToken: string;
  expires: string;
}> {
  const body = new URLSearchParams({
    app_name: "Libation",
    source_token: refreshToken,
    requested_token_type: "access_token",
    source_token_type: "refresh_token",
  });

  const res = await fetch(AMAZON_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amazon token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };

  const expires = new Date(Date.now() + data.expires_in * 1000).toISOString();

  return {
    accessToken: data.access_token,
    expires,
  };
}

/**
 * Refresh all accounts in the Libation container's AccountsSettings.json.
 * Updates the access token for each account and restarts the container.
 */
export async function refreshAllAccounts(): Promise<{
  refreshed: Array<{ accountId: string; expires: string }>;
  failed: Array<{ accountId: string; error: string }>;
}> {
  const settings = await readAccountsSettings();
  const refreshed: Array<{ accountId: string; expires: string }> = [];
  const failed: Array<{ accountId: string; error: string }> = [];

  for (const account of settings.Accounts) {
    const refreshToken = account.IdentityTokens?.RefreshToken?.Value;
    if (!refreshToken) {
      failed.push({
        accountId: account.AccountId,
        error: "No refresh token",
      });
      continue;
    }

    try {
      const result = await refreshAudibleToken(refreshToken);
      account.IdentityTokens.ExistingAccessToken.TokenValue =
        result.accessToken;
      account.IdentityTokens.ExistingAccessToken.Expires = result.expires;
      refreshed.push({
        accountId: account.AccountId,
        expires: result.expires,
      });
    } catch (e) {
      failed.push({
        accountId: account.AccountId,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  if (refreshed.length > 0) {
    await writeAccountsSettings(settings);
  }

  return { refreshed, failed };
}

/**
 * Get account status (token expiration, account names).
 */
export async function getAccountStatus(): Promise<
  Array<{
    accountId: string;
    accountName: string;
    locale: string;
    tokenExpires: string;
    isExpired: boolean;
  }>
> {
  const settings = await readAccountsSettings();
  return settings.Accounts.map((a) => {
    const expires = a.IdentityTokens?.ExistingAccessToken?.Expires || "";
    return {
      accountId: a.AccountId,
      accountName: a.AccountName,
      locale: a.IdentityTokens?.LocaleName || "us",
      tokenExpires: expires,
      isExpired: expires ? new Date(expires) < new Date() : true,
    };
  });
}

// ── Helpers ──

function getPortainerConfig() {
  const baseUrl = (process.env.PORTAINER_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.PORTAINER_API_KEY || "";
  const endpointId = process.env.PORTAINER_ENDPOINT_ID || "3";
  if (!baseUrl || !apiKey) throw new Error("Portainer not configured");
  return { baseUrl, apiKey, endpointId };
}

async function findLibationContainerId(): Promise<string> {
  const { baseUrl, apiKey, endpointId } = getPortainerConfig();
  const res = await fetch(
    `${baseUrl}/api/endpoints/${endpointId}/docker/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ name: ["libation"] }))}`,
    { headers: { "X-API-Key": apiKey } }
  );
  const containers = (await res.json()) as Array<{
    Id: string;
    Names: string[];
  }>;
  const match = containers.find((c) =>
    c.Names.some((n) => n === "/libation" || n === "libation")
  );
  if (!match) throw new Error("Libation container not found");
  return match.Id;
}

/**
 * Extract the first file's content from a tar archive.
 */
function extractFileFromTar(tar: Uint8Array): string {
  // Tar header: 512 bytes. Name at 0, size at 124 (12 bytes, octal).
  let offset = 0;
  while (offset < tar.length) {
    // Check for empty block (end of archive)
    const header = tar.slice(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    // Read file size from header bytes 124-135 (octal string)
    const sizeStr = new TextDecoder()
      .decode(header.slice(124, 136))
      .replace(/\0/g, "")
      .trim();
    const size = parseInt(sizeStr, 8) || 0;

    offset += 512; // skip header

    if (size > 0) {
      const content = new TextDecoder().decode(tar.slice(offset, offset + size));
      return content;
    }

    // Skip to next 512-byte boundary
    offset += Math.ceil(size / 512) * 512;
  }
  throw new Error("No file found in tar archive");
}

/**
 * Create a minimal tar archive containing a single file.
 */
function createTarWithFile(filename: string, content: string): Uint8Array {
  const contentBytes = new TextEncoder().encode(content);
  const size = contentBytes.length;
  const paddedSize = Math.ceil(size / 512) * 512;

  // Total: 512 header + paddedSize content + 1024 end-of-archive
  const tar = new Uint8Array(512 + paddedSize + 1024);

  // Write filename (max 100 chars)
  const nameBytes = new TextEncoder().encode(filename.slice(0, 100));
  tar.set(nameBytes, 0);

  // File mode: 0644
  const mode = new TextEncoder().encode("0000644\0");
  tar.set(mode, 100);

  // uid/gid: 0
  const zero = new TextEncoder().encode("0000000\0");
  tar.set(zero, 108); // uid
  tar.set(zero, 116); // gid

  // File size in octal
  const sizeOctal = new TextEncoder().encode(
    size.toString(8).padStart(11, "0") + "\0"
  );
  tar.set(sizeOctal, 124);

  // Modification time
  const mtime = new TextEncoder().encode(
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0") + "\0"
  );
  tar.set(mtime, 136);

  // Type flag: regular file
  tar[156] = 0x30; // '0'

  // USTAR magic
  const ustar = new TextEncoder().encode("ustar\0");
  tar.set(ustar, 257);
  const version = new TextEncoder().encode("00");
  tar.set(version, 263);

  // Compute checksum
  // First fill checksum field with spaces
  for (let i = 148; i < 156; i++) tar[i] = 0x20;
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += tar[i];
  const checksumStr = new TextEncoder().encode(
    checksum.toString(8).padStart(6, "0") + "\0 "
  );
  tar.set(checksumStr, 148);

  // Write content
  tar.set(contentBytes, 512);

  return tar;
}
