# Audible → Audiobookshelf Listening Stats Importer

This tool imports your **Audible listening history** (from `Listening.csv`) into **Audiobookshelf** so Audiobookshelf can show accurate **listening stats** and (optionally) update **continue listening / progress**.

It does two things:

1) **Creates playback sessions** in Audiobookshelf (this is what drives listening stats)  
2) **Optionally updates progress** (continue listening position, finished status)

> Works best when your Audiobookshelf library items have **Audible ASIN** metadata.

---

## How you get `Listening.csv` (Amazon data request)

Audible does *not* always provide `Listening.csv` directly in the Audible app export options. The reliable way is requesting your data from Amazon:

1. Go to Amazon’s privacy/data export portal (often called “Request your data”).
2. Request your Audible / listening history data export.
3. When the export is ready, download the archive and locate `Listening.csv`.
4. Put `Listening.csv` next to this script **or** point to it with `--csv`.

Tip: keep the original export archive somewhere safe. You can rerun imports later.

---

## Requirements

- Python 3.10+ (3.11+ recommended)
- Network access to your Audiobookshelf server
- Audiobookshelf API token for your user

---

## Install

```bash
python -m pip install -r requirements.txt
```

---

## Setup: `secrets.txt`

Create a `secrets.txt` next to the script:

```txt
# Audiobookshelf connection
ABS_URL=http://your-server:13378
ABS_TOKEN=your_token_here

# Optional: choose libraries (comma-separated IDs and/or names)
ABS_LIBRARIES=Library A,Library B

# Optional: import only listens since this date
AUDIBLE_SINCE=2025-01-01
```

Notes:
- Lines starting with `#` are comments.
- Quotes are OK: `ABS_TOKEN="..."`.
- Precedence is: **CLI flags > secrets.txt > environment variables**.

---

## Quick start

### 1) Dry run (recommended)
Parses the CSV, aggregates day-rows, attempts to match ASINs, and writes a report — **no API calls**:

```bash
python audible_to_audiobookshelf_libraries.py --dry-run --report audible_import_report.json
```

### 2) Import for real
```bash
python audible_to_audiobookshelf_libraries.py --report audible_import_report.json
```

If you put `Listening.csv` and `secrets.txt` in the same folder as the script, you can usually run with no extra flags.

---

## Library selection

Audiobookshelf can have multiple “book” libraries. You can:

### A) Select interactively (menu)
```bash
python audible_to_audiobookshelf_libraries.py --select-libraries
```

### B) Specify libraries by name or ID
```bash
python audible_to_audiobookshelf_libraries.py --libraries "Library A"
```

or:
```bash
python audible_to_audiobookshelf_libraries.py --libraries <library-id-guid>
```

Multiple:
```bash
python audible_to_audiobookshelf_libraries.py --libraries "Library A,<library-id-guid>"
```

If you don’t specify anything and you run from a normal terminal, it will show a selection prompt by default.

---

## Common options

### Custom CSV path
```bash
python audible_to_audiobookshelf_libraries.py --csv /path/to/Listening.csv
```

### Import only newer listens
```bash
python audible_to_audiobookshelf_libraries.py --since 2025-01-01
```

### Sessions only (skip progress updates)
If you only care about **listening stats** and want the least invasive import:

```bash
python audible_to_audiobookshelf_libraries.py --no-progress
```

### Tune batch size
If your server is slow or you want smaller requests:

```bash
python audible_to_audiobookshelf_libraries.py --batch-size 100
```

---

## What “matching” means (ASIN)

Audible identifies books with an **ASIN**. This importer matches CSV rows to Audiobookshelf items by:

- Audible ASIN from the CSV
- Audiobookshelf item metadata ASIN (recommended to have)

### If you have lots of unmatched ASINs
You may see output like:

- `Unmatched: <N> day-rows (unique ASINs: <M>)`

This usually means your Audiobookshelf items don’t have ASIN metadata.

**Fix options:**
- Ensure your Audiobookshelf metadata provider populates ASIN for Audible-origin books
- Edit metadata for those items and add ASIN
- Then rerun the importer

The JSON report (`--report`) includes a list of unmatched ASINs to help you track what’s missing.

---

## Output / report

The script prints summary counts and optionally writes a JSON report including:
- number of Audible day-rows aggregated
- matched vs unmatched rows + unique ASIN counts
- session batches sent + success/fail counts
- (optional) progress updates applied

---

## Integration steps (make it part of your workflow)

### Option 1: Run manually after each new Amazon export
1) Drop new `Listening.csv` into the repo folder  
2) Run dry-run to verify matches  
3) Run real import  

### Option 2: Schedule it (Windows Task Scheduler)
1) Put `Listening.csv`, `secrets.txt`, and the script in a stable folder  
2) Create a Scheduled Task that runs:
   - Program: `python`
   - Arguments: `audible_to_audiobookshelf_libraries.py --report audible_import_report.json`
   - Start in: the folder containing the script

> Note: Amazon exports are not automatic; the scheduled task is most useful if you regularly overwrite `Listening.csv` with a newer export.

### Option 3: Run it on a Linux host/NAS (cron)
If your host supports cron (or a scheduled job):
- Place the script + `secrets.txt` somewhere persistent
- Run weekly/monthly, assuming you update `Listening.csv` periodically

Example cron entry:
```cron
0 3 * * 0 /usr/bin/python3 /path/to/audible_to_audiobookshelf_libraries.py --csv /path/to/Listening.csv --report /path/to/report.json
```

---

## Troubleshooting

### “JSONDecodeError” on progress update
Some Audiobookshelf versions return empty/non-JSON responses for certain endpoints. If you see odd behavior:
- run with `--no-progress` to import sessions only (stats still work)

### “Unmatched ASINs”
- Your Audiobookshelf items likely lack ASIN metadata.
- Check one item’s metadata in Audiobookshelf and confirm it contains the correct ASIN.

### “Could not determine user id from /api/me”
- Token is invalid or missing permissions
- Confirm `ABS_TOKEN` is correct and belongs to an Audiobookshelf user

---

## Privacy

Your Audible export can contain sensitive listening information. This tool:
- Reads `Listening.csv` locally
- Sends only the minimum necessary session/progress data to your Audiobookshelf server
- Does not upload your CSV anywhere else

---

## License

Use it however you want. If you’d like a formal license file (MIT, Apache-2.0, etc.), add one.
