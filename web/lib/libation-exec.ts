/**
 * Manage the Libation container via Portainer's Docker API proxy.
 *
 * Portainer proxies the Docker Engine API at:
 *   {PORTAINER_URL}/api/endpoints/{endpointId}/docker/...
 *
 * Authentication: X-API-Key header with a Portainer access token.
 */

const CONTAINER_NAME = "libation";

function getPortainerConfig() {
  const url = process.env.PORTAINER_URL;
  const apiKey = process.env.PORTAINER_API_KEY;
  const endpointId = process.env.PORTAINER_ENDPOINT_ID || "3";

  if (!url) throw new Error("PORTAINER_URL not configured");
  if (!apiKey) throw new Error("PORTAINER_API_KEY not configured");

  return {
    baseUrl: url.replace(/\/+$/, ""),
    apiKey,
    endpointId,
  };
}

function dockerApiUrl(path: string): string {
  const { baseUrl, endpointId } = getPortainerConfig();
  return `${baseUrl}/api/endpoints/${endpointId}/docker${path}`;
}

function headers(): Record<string, string> {
  const { apiKey } = getPortainerConfig();
  return {
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
  };
}

/**
 * Find the Libation container ID by name.
 */
async function findContainerId(): Promise<string | null> {
  const res = await fetch(
    dockerApiUrl(`/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ name: [CONTAINER_NAME] }))}`),
    { headers: headers() }
  );

  if (!res.ok) {
    throw new Error(`Portainer list containers failed: ${res.status}`);
  }

  const containers = (await res.json()) as Array<{
    Id: string;
    Names: string[];
    State: string;
  }>;

  const match = containers.find((c) =>
    c.Names.some((n) => n === `/${CONTAINER_NAME}` || n === CONTAINER_NAME)
  );

  return match?.Id || null;
}

/**
 * Execute a command inside the Libation container via Portainer.
 * Uses Docker exec API: create exec instance, then start it.
 */
async function portainerExec(
  cmd: string[]
): Promise<{ stdout: string; stderr: string }> {
  const containerId = await findContainerId();
  if (!containerId) {
    throw new Error(`Container "${CONTAINER_NAME}" not found via Portainer`);
  }

  // Step 1: Create exec instance
  const createRes = await fetch(
    dockerApiUrl(`/containers/${containerId}/exec`),
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        AttachStdout: true,
        AttachStderr: true,
        Cmd: cmd,
      }),
    }
  );

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Portainer exec create failed (${createRes.status}): ${text}`);
  }

  const { Id: execId } = (await createRes.json()) as { Id: string };

  // Step 2: Start exec and capture output
  const startRes = await fetch(
    dockerApiUrl(`/exec/${execId}/start`),
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ Detach: false, Tty: false }),
    }
  );

  if (!startRes.ok) {
    const text = await startRes.text();
    throw new Error(`Portainer exec start failed (${startRes.status}): ${text}`);
  }

  // The response body contains multiplexed stdout/stderr stream.
  // Each frame: [type(1 byte), 0, 0, 0, size(4 bytes big-endian), payload]
  // type: 1=stdout, 2=stderr
  const rawBuffer = await startRes.arrayBuffer();
  const bytes = new Uint8Array(rawBuffer);

  let stdout = "";
  let stderr = "";
  let offset = 0;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) {
      // Remaining bytes don't form a complete header — treat as raw stdout
      stdout += new TextDecoder().decode(bytes.slice(offset));
      break;
    }

    const streamType = bytes[offset];
    const size =
      (bytes[offset + 4] << 24) |
      (bytes[offset + 5] << 16) |
      (bytes[offset + 6] << 8) |
      bytes[offset + 7];

    offset += 8;

    if (size <= 0 || offset + size > bytes.length) {
      // Invalid frame — dump remaining as stdout
      stdout += new TextDecoder().decode(bytes.slice(offset));
      break;
    }

    const payload = new TextDecoder().decode(bytes.slice(offset, offset + size));
    if (streamType === 2) {
      stderr += payload;
    } else {
      stdout += payload;
    }
    offset += size;
  }

  // Check exec exit code
  const inspectRes = await fetch(dockerApiUrl(`/exec/${execId}/json`), {
    headers: headers(),
  });
  if (inspectRes.ok) {
    const info = (await inspectRes.json()) as { ExitCode: number };
    if (info.ExitCode !== 0) {
      throw new Error(
        `Command exited with code ${info.ExitCode}\nstdout: ${stdout}\nstderr: ${stderr}`
      );
    }
  }

  return { stdout, stderr };
}

/**
 * Trigger a Libation scan to discover new Audible books.
 */
export async function libationScan(
  accounts?: string[]
): Promise<{ stdout: string; stderr: string }> {
  const cmd = ["libationcli", "scan"];
  if (accounts && accounts.length > 0) {
    cmd.push(...accounts);
  }
  return portainerExec(cmd);
}

/**
 * Trigger Libation to download/liberate audiobooks.
 */
export async function libationDownload(options?: {
  asin?: string;
  force?: boolean;
  pdfOnly?: boolean;
}): Promise<{ stdout: string; stderr: string }> {
  const cmd = ["libationcli", "liberate"];
  if (options?.force) cmd.push("--force");
  if (options?.pdfOnly) cmd.push("--pdf");
  if (options?.asin) cmd.push(options.asin);
  return portainerExec(cmd);
}

/**
 * Check if the Libation Docker container is running via Portainer.
 */
export async function isContainerRunning(): Promise<boolean> {
  try {
    const containerId = await findContainerId();
    if (!containerId) return false;

    const res = await fetch(
      dockerApiUrl(`/containers/${containerId}/json`),
      { headers: headers() }
    );
    if (!res.ok) return false;

    const info = (await res.json()) as { State: { Running: boolean } };
    return info.State?.Running === true;
  } catch {
    return false;
  }
}

/**
 * Check if Portainer itself is reachable and configured.
 */
export async function isPortainerAvailable(): Promise<boolean> {
  try {
    const { baseUrl, apiKey } = getPortainerConfig();
    const res = await fetch(`${baseUrl}/api/status`, {
      headers: { "X-API-Key": apiKey },
    });
    return res.ok;
  } catch {
    return false;
  }
}
