# photo-audit

Utilities to identify — and later fix — date problems in a sprawling photo/video
library spread across multiple drives.

## Why

Photos get filed into a `YYYY/YYYY-MM-DD Title` folder layout, but the date in a
filename or folder is often **missing or simply wrong** — e.g. iMazing names
exported files by _transfer_ date, not capture date. File metadata (EXIF /
QuickTime) is the reliable source of truth. These tools compare the two.

## Status

Scenario detection, report-only. No files are modified yet.

| Scenario           | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `WRONG_DATE`       | filename or ancestor folder has a date that disagrees with metadata |
| `MISSING_DATE`     | metadata has a capture date, but the name/folder does not           |
| `NO_METADATA_DATE` | the file carries no usable capture date (scans, some screenshots)   |
| `CONSISTENT`       | name/folder dates match metadata                                    |

## Usage

```sh
npm install
npm run audit -- "/Volumes/CyanPhotos/iMazing" --limit 600
npm run audit -- "/Volumes/CyanPhotos/iMazing" --show-all
```

- `--limit N` — stop after N files (quick sample)
- `--show-all` — also list `MISSING_DATE` / `NO_METADATA_DATE`

## Development

```sh
npm test          # vitest, red/green TDD
npm run typecheck # tsc --noEmit
```

## Design notes

- **Metadata date precedence:** `DateTimeOriginal` → `CreationDate` → `CreateDate`.
  `CreateDate` is last because QuickTime stores it in UTC, which can shift a
  late-evening video onto the wrong calendar day. `CreationDate` is timezone-aware.
- Date comparison is at the coarsest shared precision, so a month-precision
  folder (`2022-06 Nadia Shoot`) counts as consistent when year+month match.
- The core (`parseDate`, `classify`, `folderDateFor`) is pure and unit-tested;
  exiftool and filesystem access live in thin outer layers (`metadata`, `walk`, `cli`).

## Roadmap

- `--fix` mode: rename/refile by metadata date, preserving title/person suffixes
- duplicate detection by content hash
- fallback dating for `NO_METADATA_DATE` files (filename patterns, file mtime)
