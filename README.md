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
  |     AUTO-SYNC: polls Audible every 10 min, downloads new
  |     purchases via Libation, triggers ABS library scans
  |
  +-- libation (rmcrackan/libation) ── headless, 6h scan loop (fallback)
  |     Downloads to /data (shared with ABS)
  |
  +-- audiobookshelf (existing) ── port 13378
        Reads /audiobooks (same folder Libation writes to)
```

**Key:** Libation's download directory and ABS's library directory point to the same NAS folder. The web app's auto-sync loop notices a new purchase within minutes, downloads it, and forces an ABS rescan — no manual steps.

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

- **Auto-sync:** New Audible purchases land in ABS within minutes, hands-free (see below)
- **Multi-user:** Switch between Drew, Mo, and Root ABS accounts
- **Audible token refresh:** Renew expired Audible tokens from the web UI (no desktop app needed)
- **One-click scan/download:** Trigger Libation scan and download from the dashboard
- **ABS library browser:** Cover art grid with search, ASIN badges
- **Listening stats import:** 5-step wizard (upload CSV, parse, match ASINs, sync sessions, results)
- **Dark mode** with system preference detection

---

## Auto-Sync (purchase → ABS in minutes)

The web app runs a background scheduler (started on server boot) that gets new
Audible purchases into Audiobookshelf automatically. Each cycle:

1. **Skip if busy** — checks that no LibationCli process is already running
   (avoids clashing with the container's own 6h loop or a manual download)
2. **Scan** — `LibationCli scan` discovers new purchases into the Libation DB
3. **Download** — if any books are pending, `LibationCli liberate` downloads them
4. **Verify** — diffs the Libation DB to confirm what actually downloaded
5. **Nesting check** — warns if Libation nested one book's folder inside another
   (known bug; warning appears in the dashboard activity feed)
6. **ABS scan** — triggers a rescan of every ABS book library so the new title
   shows up immediately
7. **Listening progress + history** — pulls per-book positions straight from
   Audible's API (using the same tokens Libation holds, auto-refreshed) and
   pushes them to the mapped ABS user:
   - **Change-gated:** each cycle first makes one tiny stats call (daily
     listening totals). If nothing was played since the last check, the full
     sync is skipped — a safety full sync still runs every 6h. Manual runs
     and dry runs always sync fully.
   - Progress is one-way and forward-only: ABS is updated only when Audible is
     ahead, and finished books are never un-finished or moved backwards
   - Listening sessions are derived from position deltas between cycles and
     upserted as one session per book per day (listen on the Audible app, and
     ABS stats fill in within the next cycle)
   - Map each Audible account to an ABS user on the Settings page (a single
     account defaults to the active user); a dry-run button there previews
     what would sync without writing anything

Control it from the **Auto-Sync card on the dashboard**: enable/disable, change
the poll interval (5–60 min, default 10), see last/next check, recent activity,
and a Sync Now button. The Libation container's own `SLEEP_TIME=6h` loop stays
on as a fallback if the web app is down.

For deep history (years of past listening), the CSV **Import wizard** is still
the tool — the automated sync records history from now on, since Audible's API
only exposes current positions, not past days.

Settings persist in `/app/data/config.json`; activity in `/app/data/sync-log.json`
(both on the `web-data` volume). Environment overrides (defaults for first run):

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTO_SYNC_ENABLED` | `true` | Set `false` to start disabled |
| `AUTO_SYNC_INTERVAL_MINUTES` | `10` | Poll interval |
| `AUTO_SYNC_PROGRESS` | `true` | Set `false` to skip listening-progress sync |
| `BOOKS_DIR` | `/audiobooks/Audiobooks` | Folder checked for nested book folders |

Watch it work: `docker logs -f audible-abs-web` and look for `[auto-sync]` lines.

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
- Auto-sync polls Audible every 10 minutes, downloads new purchases, and
  triggers ABS rescans (Libation's 6h loop remains as fallback)
- Use the web dashboard to monitor auto-sync, trigger scans, and manage tokens

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
- Auto-sync triggers ABS scans automatically after each download — check the
  dashboard's Auto-Sync activity feed and `docker logs audible-abs-web`
  (`[auto-sync]` lines) for errors first.
- Verify Libation's `/data` mount points to the same directory as ABS's library folder.
- Manually trigger an ABS library scan: `POST /api/libraries/{id}/scan` with admin token.

### Auto-sync not running
- The scheduler starts with the web container — check `docker logs audible-abs-web`
  for `[auto-sync] scheduler started`.
- Make sure it's enabled on the dashboard's Auto-Sync card.
- Cycles skip while another LibationCli process is running (shown as
  "Libation is busy") — this is normal during the container's own 6h scan.

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
