# Changelog

## v0.1.2 (2026-07-22)

Automatic listening progress + history sync from Audible, change-gated to skip idle cycles.

- Each auto-sync cycle pulls per-book positions from Audible's API (same tokens Libation holds, auto-refreshed) and pushes them to the mapped ABS user — one-way, forward-only, never un-finishing a book
- Listening sessions are derived from position deltas and upserted one-per-book-per-day, so Audible-app listening shows up in ABS stats within a cycle
- Cheap change gate: one stats call per cycle skips the full sync when nothing was played (6h safety floor; manual runs always sync fully)
- Settings page: Audible account → ABS user mapping with a dry-run tester; dashboard card shows progress/session activity
- Fixed: session sync posted a bare array instead of `{sessions}`, so ABS silently dropped sessions (also fixes the CSV import wizard); Audible last-position requests over 25 ASINs were rejected with a 400
- Also ships the `scripts/portainer_redeploy.py` one-command deploy (committed post-v0.1.1)

## v0.1.1 (2026-07-22)

Auto-sync: new Audible purchases now land in Audiobookshelf automatically within minutes.

- Background scheduler in the web app checks Audible every 10 min (configurable 5–60): Libation scan → download new books → ABS library rescan
- Busy-check prevents overlap with Libation's own 6h loop and manual downloads
- Dashboard Auto-Sync card: on/off toggle, interval, last/next check, activity feed, Sync Now
- Warns when Libation nests one book's folder inside another (known bug)
- `web/data/` is now gitignored (its config.json holds ABS tokens)

First tagged release — includes the existing Next.js dashboard + NAS Docker stack.
