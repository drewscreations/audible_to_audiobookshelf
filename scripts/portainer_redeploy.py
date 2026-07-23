"""Redeploy the audible_to_audiobookshelf stack in Portainer (pull + rebuild).

Usage: python scripts/portainer_redeploy.py

Reads PORTAINER_URL / PORTAINER_API_KEY from web/.env.local (or the
environment) and never prints them. Finds the stack whose GitConfig points at
this repo, re-uses its existing Env so stack variables (ABS tokens etc.) are
preserved, and calls the synchronous /git/redeploy endpoint, which pulls main
and rebuilds the web image on the NAS. Expect it to block for several minutes.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = REPO_ROOT / "web" / ".env.local"
REPO_MARKER = "audible_to_audiobookshelf"

env = dict(os.environ)
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            env.setdefault(k, v)

try:
    base = env["PORTAINER_URL"].rstrip("/")
    key = env["PORTAINER_API_KEY"]
except KeyError as e:
    sys.exit(f"Missing {e} (set it in web/.env.local or the environment)")


def api(method, path, body=None, timeout=60):
    req = urllib.request.Request(
        base + path,
        method=method,
        headers={"X-API-Key": key, "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None,
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode() or "{}")


stacks = api("GET", "/api/stacks")
stack = next(
    (s for s in stacks if REPO_MARKER in ((s.get("GitConfig") or {}).get("URL") or "")),
    None,
)
if not stack:
    print("stacks visible:", [(s["Id"], s["Name"]) for s in stacks])
    sys.exit("No stack with a GitConfig URL containing " + REPO_MARKER)

sid, endpoint = stack["Id"], stack["EndpointId"]
ref = (stack.get("GitConfig") or {}).get("ReferenceName") or "refs/heads/main"
env_names = [e.get("name") for e in (stack.get("Env") or [])]
print(f"stack id={sid} name={stack['Name']} endpoint={endpoint} ref={ref}")
print(f"preserving {len(env_names)} stack env vars: {env_names}")

print("redeploying (pull + rebuild on NAS; this blocks until compose up finishes)...")
result = api(
    "PUT",
    f"/api/stacks/{sid}/git/redeploy?endpointId={endpoint}",
    body={
        "env": stack.get("Env") or [],
        "prune": False,
        "pullImage": False,
        "repositoryAuthentication": False,
        "repositoryReferenceName": ref,
    },
    timeout=1800,
)
print("redeploy finished: stack status =", result.get("Status"))
