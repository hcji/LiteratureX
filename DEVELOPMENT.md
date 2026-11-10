# Development Log & Guide

## 1. Environment

The build machine started without the web/desktop toolchain, so the project bootstraps its own:

| Component | Resolution |
|---|---|
| Node.js | Portable Node 24.22.2 LTS downloaded by `scripts/bootstrap_node.py` into `.tools/node` (SHA-256 verified). No admin rights. |
| npm | Bundled with Node (11.19.1) |
| Electron | 45.2.3, binary downloaded manually with `node node_modules/electron/install.js` (new npm install-script policy may skip postinstall) |
| SQLite | Electron's built-in `node:sqlite` (Node 24.22) with FTS5 — verified at startup and in tests |
| Native compiler | **Not required** — every dependency is pure JS/WASM |
| Python | Only used for dev fixtures/icons (`PyMuPDF`, Pillow) |

Environment variables useful during development:

| Variable | Purpose |
|---|---|
| `LITERATUREX_USER_DATA` | Overrides Electron `userData` (DB/PDFs/backups). Used by E2E for isolated runs. |
| `LITERATUREX_OFFLINE=1` | Skips external PDF metadata enrichment; used by deterministic E2E. |
| `ELECTRON_MIRROR` | Optional mirror for the Electron binary download. |

## 2. Setup

```bat
python scripts\bootstrap_node.py
set "PATH=E:\LiteratureX\.tools\node;%PATH%"
npm install
REM if node_modules\electron\dist\electron.exe is missing:
node node_modules\electron\install.js
npm run dev
```

If npm reports that Electron's install script was not approved, run the manual install command above; this project does not need any other postinstall scripts.

## 3. Commands

```bat
npm run dev          # Electron + Vite dev window (F12 toggles devtools)
npm run typecheck    # tsc for main/preload/shared/tests + renderer
npm test             # Vitest unit + integration
npm run test:e2e     # build then Playwright Electron E2E
npm run build        # electron-vite production build (out/)
npm run dist:dir     # dev verification: win-unpacked only; deletes stale release exe files
npm run release:unpacked  # alias for dist:dir
npm run dist:win     # formal release only: NSIS installer + portable exe
```

Development policy: each change uses `npm run dist:dir` (or `release:unpacked`) and only keeps `release/win-unpacked`. Installer/portable `.exe` artifacts are removed by `scripts/clean-release-exes.cjs`; `dist:win` is run only for an actual release.

## 4. Milestones

| Milestone | Status | Deliverable |
|---|---|---|
| M0 Toolchain & scaffold | Done | Portable Node, Electron/Vite/React/TS/Tailwind shell, docs skeleton, icon |
| M1 Data layer | Done | 24-table schema, migrations, repositories, FTS5, jobs, encrypted settings |
| M2 Library | Done | PDF import (single/multi/folder/drag), text/metadata/DOI extraction, managed/linked storage, three-pane UI, editor, notes, search |
| M3 Discovery | Done | Journal search, RSS discovery/validation, subscriptions/groups, conditional sync, sync history, three feed views, OA PDF |
| M4 AI classification | Done | Taxonomy editor, provider abstraction, structured output, thresholds, review queue, manual-preservation, history, batch jobs, suggestions, offline classifier |
| M5 Search & assistant | Done | FTS5 search with filters/ranking/highlights; assistant with citations, summaries, comparison, trends, related, offline fallback |
| M6 Data & polish | Done | BibTeX/RIS/CSV/JSON I/O, full backup/restore, dashboard, settings, bilingual UI, dark theme, performance test |
| M7 Verification & packaging | Done | Typecheck/tests/E2E green; Windows NSIS + portable built; packaged executable smoke-tested |

## 5. Verification record

Run on 2026-11-09:

- `npm run typecheck` — pass.
- `npm test` — **42 tests, 12 files, all pass**:
  - migration/CRUD/search/FTS
  - DOI and normalized-title deduplication
  - manual classification preservation and rejected-category blocking
  - local heuristic classification
  - PDF extraction/import/duplicate/linked storage
  - RSS parsing + conditional sync + dedup
  - BibTeX/RIS/CSV/JSON round-trips
  - backup/restore and automatic snapshots
  - assistant offline summaries/compare/trends/retrieval
  - OpenAI-compatible mocked classification (JSON mode, clamping, unknown IDs, invalid JSON)
  - 10,000-reference scale test
  - journal search/discovery patterns and Crossref fallback feed (mock HTTP)
  - office plugin service: token-protected HTTP API, WPS install/merge/uninstall, Word certificate/manifest/HTTPS task pane
- Performance (10k references): **FTS search ≈5–9 ms, paginated list ≈1.5–2.4 ms**.
- Optional live smoke (temporary, not retained in CI): Nature journal search → RSS discovery → subscribe/sync (75 items); Analytical Chemistry → Crossref fallback feed → subscribe/sync (80 items).
- Playwright E2E — **6 tests, all pass**:
  1. taxonomy creation → PDF import → AI classification → manual correction preserved → full-text search → advanced filters → manual RSS subscription + sync → restart persistence;
  2. PDF preview canvas renders;
  3. library header sorting and double-click system-opener error path;
  4. assistant cited offline summary;
  5. settings/AI test/theme/language switching/database vacuum;
  6. local plugin service status + WPS add-in install/uninstall against a temporary jsaddons directory.
- Screenshots: `docs/screenshots/`.

## 6. Decisions and rationale

1. **Electron instead of Tauri** — no Rust/MSVC on the machine; Electron with `node:sqlite` gives the same local-first capabilities without native builds. Documented in README/ARCHITECTURE.
2. **No native modules** — better-sqlite3/keytar avoided; FTS5 comes from the bundled SQLite.
3. **Local heuristic classifier** — guarantees classification/taxonomy/review workflows work without an API key, and makes tests deterministic.
4. **Full text to AI is opt-in** — privacy-first default; metadata/abstract still produce useful classification.
5. **Manual precedence at the row level** — `decided_by='user'` is checked before every AI upsert; rejected rows are retained as blockers.
6. **Category = collection** — user-defined taxonomy doubles as the collection tree, avoiding two competing organizational systems.
7. **FTS5 maintained application-side** — avoids fragile triggers over joined authors/categories and keeps rebuilds explicit.
8. **Zotero import deferred** — the normalized schema already maps 1:1; implementing the importer does not require model changes.
9. **Electron builder targets Windows first** — product requirement; macOS/Linux targets are configuration-only work.

## 7. Testing strategy

- **Unit:** normalization, BibTeX parser.
- **Integration:** real SQLite (`:memory:`) + real repositories/services; external HTTP only where explicitly mocked (RSS fixture server/fetch stub, OpenAI fetch stub, PDF fixture).
- **E2E:** Playwright launches the built Electron app with an isolated `userData` directory; a local HTTP server serves the RSS fixture. Native file dialogs are bypassed through the same typed IPC methods the UI uses for PDF import, while category creation, classification, search, RSS subscription, settings and PDF preview are exercised through the UI.
- **Persistence:** the E2E workflow closes and relaunches the app against the same data directory.

### Running individual tests

```bat
npx vitest run tests/integration/db.test.ts
npx playwright test tests/e2e/workflow.spec.ts
```

## 8. Debugging

- Open devtools in development with **F12**.
- Main-process logs go to the terminal. Renderer errors are caught by an ErrorBoundary (data is preserved) and logged to the devtools console.
- The database can be inspected with any SQLite tool; WAL files may exist while the app runs.
- To reset only UI state, delete `application_settings`; to reset everything, point `LITERATUREX_USER_DATA` at a new directory.
- E2E screenshots are written to `.tmp/e2e/`; failures keep traces under `test-results/`.

## 9. Packaging notes

Development builds use `npm run dist:dir` (or `npm run release:unpacked`). It builds `release/win-unpacked/` and removes top-level installer/portable `.exe` files left from earlier formal releases. No installer is produced during normal iteration.

For a formal release only, `npm run dist:win` produces in `release/`:

- `LiteratureX Setup 0.1.0.exe` — NSIS installer (per-user, choosable directory, desktop/start-menu shortcuts)
- `LiteratureX 0.1.0.exe` — portable executable
- `win-unpacked/` — unpacked app used for smoke testing

The packaged `win-unpacked/LiteratureX.exe` is smoke-tested with Playwright using an isolated data directory: dashboard renders, `fts5: true`, PDF import extracts metadata/full text, local AI classification produces a category, and the plugin service starts on loopback. The installer is unsigned; Windows SmartScreen may warn.

Note: packaging needs the local Electron distribution (`electronDist: node_modules/electron/dist`) and the electron-builder binaries mirror in this environment. A freshly packaged `LiteratureX.exe` can be briefly locked by Windows antivirus scanning, causing 7-Zip “Cannot open output file / file in use”; waiting ~20 seconds and retrying succeeds.

## 10. Known technical limitations

- No OCR for scanned PDFs (text extraction returns empty; status marked `unavailable`).
- Publisher RSS endpoints are not universal; discovery is best-effort and manual URL entry is the fallback.
- Live external APIs are not part of CI; they are optional runtime dependencies with graceful failure.
- Zotero import and vector search are designed-for but not implemented.
- Only Windows packages are built/verified; macOS/Linux require icon/notarization work.
- API keys cannot be decrypted after moving a backup to another OS user; they are intentionally excluded from backups.
- Custom managed-PDF directories restored from another machine may need path adjustments.
