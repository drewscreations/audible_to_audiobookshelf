# Audible to Audiobookshelf

A web dashboard and automation tool for managing your Audible library with Audiobookshelf.

**Primary:** Automatically discover new Audible purchases, download them via Libation, and sync to Audiobookshelf — all running on a NAS with zero manual steps.

**Secondary:** Import Audible listening history (stats and progress) into Audiobookshelf.

---

## Architecture

Everything runs on a Synology NAS via Docker, managed through Portainer:

```
Portainer (manages stack)
  |
  +-- audible-abs-web (Next.js) ── port 3000
  |     Proxies ABS API, reads Libation DB, manages containers
  |
  +-- libation (rmcrackan/libation) ── headless, auto-scans every 6h
  |     Downloads to /data (shared with ABS)
  |
  +-- audiobookshelf (existing) ── port 13378
        Reads /audiobooks (same folder Libation writes to)
```

**Key:** Libation's download directory and ABS's library directory point to the same NAS folder. When Libation downloads a book, ABS auto-detects it.

---

## Web Dashboard

Access at `http://<nas-tailscale-ip>:3000`

### Pages

| Page | Purpose |
|------|---------|
| `/` | Dashboard — ABS connection, Libation stats, quick actions |
| `/library` | Full Audible library from Libation DB with search, filter, download buttons |
| `/abs` | ABS library browser with cover art grid |
| `/libation` | Container management, Audible account status, token refresh, scan/download |
| `/import` | Listening stats import wizard (CSV upload, ASIN matching, batch sync) |
| `/history` | Past import reports |
| `/settings` | ABS connection, user picker (multi-user), Portainer config |

### Features

- **Multi-user:** Switch between Drew, Mo, and Root ABS accounts
- **Audible token refresh:** Renew expired Audible tokens from the web UI (no desktop app needed)
- **One-click scan/download:** Trigger Libation scan and download from the dashboard
- **ABS library browser:** Cover art grid with search, ASIN badges
- **Listening stats import:** 5-step wizard (upload CSV, parse, match ASINs, sync sessions, results)
- **Dark mode** with system preference detection

---

## Deployment (Portainer)

### Prerequisites

- Synology NAS with Docker and Portainer
- Audiobookshelf already running
- Tailscale for network access

### Deploy via Portainer

1. In Portainer, create a new stack from Git:
   - Repository URL: `https://github.com/drewscreations/audible_to_audiobookshelf.git`
   - Compose file: `docker-compose.yml`
   - Branch: `refs/heads/main`

2. Set environment variables:
   ```
   ABS_TOKEN_DREW=eyJ...
   ABS_TOKEN_MO=eyJ...
   ABS_TOKEN_ROOT=eyJ...
   ABS_TOKEN=eyJ...
   PORTAINER_API_KEY=ptr_...
   ```

3. Deploy the stack.

4. Upload Libation credentials (AccountsSettings.json) to the Libation container's `/config/` directory via Portainer console or archive API.

5. Fix permissions: exec into the web container and run:
   ```sh
   chmod 777 /libation-config && chmod 666 /libation-config/*
   ```

6. Restart the Libation container. It will auto-scan your Audible library.

### After Deployment

- Web app: `http://<tailscale-ip>:3000`
- Libation auto-scans every 6 hours and downloads new books
- ABS auto-detects new files in its library folder
- Use the web dashboard to monitor, trigger scans, and manage tokens

---

## Docker Compose Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `web` | Built from `./web` | 3000 (host) | Next.js dashboard + API proxy |
| `libation` | `rmcrackan/libation:latest` | None (host) | Audible scanner + downloader |

Both use `network_mode: host` for outbound internet access on Synology.

### Volume Mounts

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `libation-config` (named) | `/config` (libation), `/libation-config` (web) | Libation DB + credentials |
| `/share/JellyWhale/Audiobooks/Audiobooks` | `/data` (libation) | Downloaded audiobooks |
| `web-data` (named) | `/app/data` (web) | Reports + config |

---

## Synology-Specific Notes

- **Host networking required:** Bridge networking on Synology doesn't provide proper NAT. Containers can't reach external APIs (api.audible.com) without `network_mode: host`.
- **Named volumes for SQLite:** Synology's btrfs filesystem has issues with SQLite WAL mode on bind mounts. Use named Docker volumes for the Libation config directory.
- **Volume paths:** SMB share `\\NAS\ShareName` maps to `/share/ShareName` inside Docker, NOT `/volume1/...`. Check existing container mounts to find the correct path.
- **Permissions:** Named volumes are root-owned. Libation runs as uid 1001 and needs world-writable files (chmod 666/777).

---

## Python CLI (Original)

The original Python CLI tool is still available at the repo root for standalone use.

### Quick Start

```bash
pip install -r requirements.txt
python audible_to_audiobookshelf.py --dry-run --report report.json
python audible_to_audiobookshelf.py --report report.json
```

### Configuration (`secrets.txt`)

```txt
ABS_URL=http://your-server:13378
ABS_TOKEN=your_token_here
ABS_LIBRARIES=Library A,Library B
AUDIBLE_SINCE=2025-01-01
```

### CLI Options

| Flag | Purpose |
|------|---------|
| `--csv` | Path to Listening.csv |
| `--abs-url`, `--token` | Override ABS connection |
| `--libraries` | Filter by library name or ID |
| `--select-libraries` | Interactive library picker |
| `--since` | Import only listens since date |
| `--dry-run` | Parse CSV without API calls |
| `--no-progress` | Sessions only (skip progress) |
| `--batch-size` | Sessions per API call (default 250) |
| `--report` | Write JSON report |

---

## Troubleshooting

### Libation scan returns "Total processed: 0"
- Audible access token may be expired. Use the web dashboard's Libation page to refresh tokens.
- If token refresh fails, re-authenticate Libation with your Audible account.

### Libation DbUpdateException during scan
- This is a known issue with Libation v13.3.3 on some filesystems. The scan and download still work despite the error — it only affects database persistence.
- Ensure the config volume uses a named Docker volume, not a bind mount.

### Books not appearing in ABS after download
- Verify Libation's `/data` mount points to the same directory as ABS's library folder.
- Trigger an ABS library scan: `POST /api/libraries/{id}/scan` with admin token.

### Container can't reach the internet
- Use `network_mode: host` in docker-compose.yml.
- Check DNS: Synology's Docker DNS may route through Pi-hole, which could block Audible domains.

### Nested book folders causing ABS duplicates
- Libation can sometimes nest one book's folder inside another (e.g., `Book 8/Book 7/Book7.m4b`).
- Fix: move the nested folder to the top level on the NAS.
- After fixing: delete the stale ABS item via API, then force rescan.

### Unmatched ASINs in stats import
- Audiobookshelf items need ASIN metadata populated for matching.
- Check item metadata in ABS and add the ASIN if missing.

---

## Tech Stack

- **Frontend:** Next.js 15 (App Router), shadcn/ui, Tailwind CSS, TypeScript
- **Backend:** Next.js API routes (proxy to ABS, manage Libation)
- **Libation DB:** better-sqlite3 (reads LibationContext.db)
- **Container Management:** Portainer API
- **Infrastructure:** Docker Compose, Synology NAS, Tailscale
- **Original CLI:** Python 3.10+, requests library

---

## License

Use it however you want. If you'd like a formal license file (MIT, Apache-2.0, etc.), add one.
