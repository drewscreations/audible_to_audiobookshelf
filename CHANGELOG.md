# Changelog

## v0.1.1 (2026-07-22)

Auto-sync: new Audible purchases now land in Audiobookshelf automatically within minutes.

- Background scheduler in the web app checks Audible every 10 min (configurable 5–60): Libation scan → download new books → ABS library rescan
- Busy-check prevents overlap with Libation's own 6h loop and manual downloads
- Dashboard Auto-Sync card: on/off toggle, interval, last/next check, activity feed, Sync Now
- Warns when Libation nests one book's folder inside another (known bug)
- `web/data/` is now gitignored (its config.json holds ABS tokens)

First tagged release — includes the existing Next.js dashboard + NAS Docker stack.
