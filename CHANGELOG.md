# Changelog

All notable changes to LiteratureX are recorded here.

## [Unreleased]

### Added
- **Configurable LLM auto-organize**: the dialog now lets the user set the maximum number of new categories, the sample size used to propose those categories, whether full text is sent, and the thinking depth (default medium-low). All unclassified library papers are processed (no 200-paper cap); each paper gets a best-effort category (low-confidence assignments are flagged for review), and new categories can only come from the sampled papers and are capped by the chosen budget.
- **Classification tags for subscription articles**: newly synced RSS items are classified in the background (LLM when configured, local keyword classifier otherwise). Discover also gets a **Tag unclassified** action and a sync-time backfill for older untagged feed items.
- **Smart ordering in Discover**: all unread papers come before read papers; within each group, papers with at least one category tag come first and papers matching no existing category last. Smart order is the default; publication date and added date remain selectable. Untagged items show an **Unclassified** badge.
- **Built-in PDF reader**: double-click a paper with an attached PDF (or use the right-click menu / PDF tab) to open the reader in the library’s middle content area. Pages are rendered as a continuous vertical stream with a scrollbar, lazy canvas rendering, live page numbers, zoom and fit-width controls. The right metadata column stays visible and can be collapsed or shown with one click; right-click inside the reader offers **Open in system app**, **Reveal file** and **Close**. The article context menu also separates the built-in reader from the system application.
- **Merge categories**: Collections has a merge mode for selecting two or more categories. The merge dialog can rename the new category with the LLM (name, description and keywords), preserves papers, keywords and child categories, and deletes the source categories.
- **Progress feedback for long-running work**: a global task list in the sidebar plus a thin top progress bar now track every operation, with determinate percentages where possible and indeterminate bars otherwise.
  - PDF imports show `current/total`, the current file name and percentage in a Library banner, the sidebar and the top bar.
  - The **LLM auto-organize** dialog now stays open with a live percentage bar, `processed/total` count and a completed/failed state before closing; it shows 100% and “completed” for a moment on success.
  - Discover’s **Tag unclassified** action and Library/Collections classification show an inline percentage banner in addition to the global task list.
  - Classification (single, batch, auto-organize and taxonomy suggestions) streams job progress into the same task list; Library and Collections show inline progress.
  - RSS sync-all reports the current feed and `feed n/total`; Discover shows an inline sync banner.
  - AI assistant answers show an animated progress bar while the model is working; OA downloads, full backups, restores and BibTeX/RIS imports also appear in the task list.
  - Backend progress events cover PDF import stages, classification jobs, sync batches, downloads, assistant calls, backups and restores.
- Keyboard shortcuts: `Ctrl/Cmd+1…6` switches pages, `Ctrl/Cmd+F` focuses the current page search (or jumps to My Library), `Ctrl/Cmd+,` opens Settings, and `Esc` closes the detail panel or clears the search box.
- Dashboard **Quick actions** card on an empty library (import PDF, add reference, add journal, configure AI) so first-run setup is visible.
- Discover and My Library detail panels now have a close button, and Discover hides the empty detail pane until an article is selected.
- Managed PDF storage now organizes files into `<year>-<journal>` folders and names each PDF `<year>-<first author>-<title>.pdf` (with a short hash suffix on name collisions). Open-access downloads use the same scheme.
- Folder PDF import recursively scans all nested subfolders.
- WPS Document Preferences now gives citation styles a right-click menu (apply, delete custom styles) and a numbered-bibliography toggle.
- PDF import now uses the configured LLM as a metadata fallback when pdf.js extraction and Crossref/OpenAlex enrichment leave core fields missing (title, authors, abstract, journal, year or DOI). LLM-derived fields are marked with lower confidence and flagged for review.
- WPS citations and the bibliography are now tracked with document bookmarks: Refresh renumbers citations in document order, updates bibliography order, and reformatting the citation style rewrites existing citations and the bibliography.
- Article right-click menus now include **Reveal file** for attached PDFs.
- My Library header now offers **Remove duplicates**, merging records with the same title/year while preserving PDFs, categories, notes and read state.
- Bilingual category keywords (Chinese and English) with separate editor fields; the classifier uses both language sets while the UI displays the active language.
- Right-click menus for the category tree (rename/edit, new subcategory, enable/disable, reclassify, delete) and journal subscriptions (view, sync, edit, pause/resume, copy feed URL, unsubscribe). All context menus open at the mouse position.
- WPS **Document Preferences** now lists built-in and public CSL-inspired citation formats, links to the public CSL style repository, and can learn a new format from a user-provided example through the LLM and save it for later use.
- LLM auto-organize can now create new root categories when no existing category fits (opt-in per run, up to 2 new categories per paper).
- Right-click context menus on Discover and Library entries provide per-item actions (open, add/remove library membership, read/star, classify, category assignment, OA download, export, trash/restore/delete). The bulk action bar now appears only for multi-selection.
- WPS Writer ribbon now mirrors the Zotero add-in button layout: Add/Edit Citation, Add/Edit Bibliography, Refresh, Document Preferences, Add Note, Unlink, Export and About, with dedicated icons and keytips.
- Discover items now have an explicit **Add to My Library** action; RSS-synced articles stay in Discover until the user adds them.
- **LLM keyword generation and auto-categorization** for unclassified library items, with a user-selected keyword count (3–20, default 8) and batch processing (up to 200 papers per run).
- Open-access PDF download now falls back to OpenAlex OA locations when Unpaywall has no contact email or no result, and supports direct PDF URLs.
- **WPS Writer citation add-in** and **Microsoft Word Office.js add-in**:
  - one-click WPS install/update into `%APPDATA%\kingsoft\wps\jsaddons` with `publish.xml` merge and safe uninstall;
  - Word task-pane manifest, local HTTPS service (`127.0.0.1:47832`), generated localhost certificate and explicit trust flow;
  - shared task-pane UI: library search, numeric/author-year citations, bibliography insertion, document-level cited-ID state;
  - token-protected loopback API (`/api/plugin/status|search|references`) shared by both hosts;
  - Settings → 文献插件 status, install/uninstall, folder shortcuts and installation guide.
- Crossref journal-article fallback feed (`crossref://journal/<ISSN>`) when a publisher offers no working RSS/Atom feed; sync support and manual validation included.
- Library list header with sortable columns: Title, Authors, Journal, Year, Added date, plus a select-all checkbox. Clicking a header toggles ascending/descending; the active sort is indicated by an arrow.
- Double-click a library row to open its attached PDF with the operating system's default application. If no PDF is attached or the file is unavailable, the publisher URL or `https://doi.org/<DOI>` opens in the default browser.
- Full-text Chinese search fallback through the SQLite LIKE path (author/category fields included).

### Changed
- UI copy pass across dialogs and Settings: shorter, direct descriptions for organize, merge, assistant, subscription, backup, restore, plugin and privacy text.
- Library, Discover and category paper lists now load **all matching entries by default**; the “Show more” pagination buttons were removed.
- Dashboard metric cards now open the matching filtered view (unread → Discover unread, review queue → Library review), and empty states distinguish an empty library from an empty filter/category.
- My Library toolbar is simpler: the PDF-only checkbox is part of **Advanced filters**, duplicate cleanup is an icon action, and sorting happens through the column headers (the redundant sort dropdown and order toggle were removed).
- Visual pass across all pages: larger micro-typography for table headers, sidebars and metadata, fewer card shadows, flatter empty states, ISO dates in the library table, and a more compact Add Journal dialog.
- Collections selects the first category automatically, and the AI suggestions entry in the sidebar now opens suggestions instead of doing nothing.
- Source badges in article details show readable labels (RSS, PDF, Manual, DOI, Import) instead of raw values.
- Removed the **Unread** scope from My Library; read state remains available through Discover and the read/unread actions.
- Library detail panel is hidden until a paper is selected, giving the table full width for browsing.
- “Recently added” scope now uses `created_at` as its initial sort while still allowing any header sort.
- Development workflow now uses `npm run dist:dir` / `release:unpacked`, keeping only `release/win-unpacked`; installer/portable exe files are removed automatically. `dist:win` is reserved for formal releases.

### Fixed
- Dashboard no longer displays a hard-coded 40% bar for pending background jobs; the actual job count is shown.
- The bulk **Restore** action in Trash used the star icon; it now uses the restore icon.
- WPS bibliography numbering now follows the selected style: numeric, GB/T 7714, Nature and IEEE are numbered; APA and author-year styles are not. Styles learned from examples capture whether the example was numbered.
- Right-click menus now open at the actual mouse position instead of a fixed corner offset.
- Syncing or refreshing a journal subscription now switches the Discover view to **All**, so previously read articles are shown again instead of appearing as an empty list.
- Discover feeds no longer drop an article the moment it is read in the Unread view: read entries stay visible in gray until the filter changes or the feed is refreshed/synced.
- Journal-name search sent unsupported Crossref parameters (`query.bibliographic` and `select` on `/journals`), so Crossref returned HTTP 400 and only OpenAlex results appeared. Crossref now uses the supported `query` parameter plus the polite-pool `mailto`.
- Publisher RSS discovery now uses current feed formats: Cell Press `/current.rss`, ScienceDirect and Wiley hyphen-free ISSNs, ACS journal codes, and the first path segment for Nature titles.
- Homepage autodiscovery failures (HTTP 403/timeouts) are reported in the discovery notes instead of being described as a missing RSS link.

### Tests
- 57 Vitest tests (including journal search/discovery, Crossref fallback sync, OA resolution, PDF LLM metadata fallback, nested folder import, bilingual categories, duplicate merging, category merging, smart Discover ordering, citation formats, and plugin/WPS ribbon tests) and 6 Playwright Electron E2E tests.
- E2E launches with isolated plugin ports (`LITERATUREX_PLUGIN_HTTP_PORT`/`HTTPS_PORT`), so tests can run while another LiteratureX instance is open.

## [0.1.0] — 2026-11-09

### Added

#### Discovery
- Journal search via Crossref journals + OpenAlex sources (name or ISSN).
- RSS/Atom discovery: homepage `<link rel="alternate">` autodiscovery, publisher patterns (Nature, Cell, Elsevier, Wiley, ACS, OUP, MDPI, Frontiers, PLOS, Springer, Taylor & Francis), generic paths, manual URL validation.
- Feed candidate validation and ranking (parse success, item count, latest date, sample titles).
- Subscription management with custom groups, publisher grouping, enable/disable, per-subscription sync interval, manual refresh.
- Background sync scheduler with ETag/Last-Modified conditional requests, DOI/title dedup, missing-field merge, sync history, error surfacing.
- Discover three-pane UI with list/compact/detailed views, unread/starred/recent filters, search, mark-read/star, save to library, open publisher page, open-access PDF download.

#### Library
- Unified article model for RSS, PDF, manual, DOI, and imported records.
- PDF import: single, multiple, folder, drag-and-drop; SHA-256 duplicate detection.
- Managed (content-addressed) or linked storage; original files never deleted silently.
- pdf.js text/metadata extraction, DOI detection, citation-line parsing (journal/year/volume/issue/pages), title/authors/abstract heuristics.
- Metadata enrichment with Crossref → OpenAlex → Semantic Scholar → PubMed fallback and TTL cache.
- Three-pane library: scope filters, category tree, sortable multi-select list, detail panel.
- Metadata editor, notes, reading status, favorites, Trash/restore/permanent delete.
- PDF preview with page/zoom controls; open/remove/reveal attachment actions.
- Uncertain metadata flagged for review; no fabricated values.

#### Taxonomy & classification
- Arbitrary-depth user categories with description, keywords, synonyms, instructions, priority, color, active flag.
- OpenAI-compatible provider abstraction + local weighted keyword classifier.
- Structured JSON classification with strict schema validation, ID validation, confidence clamping, multi-label output, evidence/keywords/reasoning, summary, unmatched topics.
- Configurable high/medium thresholds mapping to auto / provisional / needs-review.
- Manual accept/reject/add/remove; `decided_by='user'` rows are never overwritten by AI or reclassification.
- Classification history and article-level history UI.
- Single, batch, per-category, and entire-library reclassification via background jobs with progress events.
- AI taxonomy improvement suggestions (new keywords/subcategories/missing topics/merge hints) requiring user approval.
- Original API key stored only as OS-encrypted ciphertext; full-text submission opt-in.

#### Search & assistant
- SQLite FTS5 across title, abstract, authors, journal, DOI, keywords, notes, AI summary, category paths, and extracted full text.
- bm25 ranking, snippets with `<mark>` highlights, filters (scope, category descendants, journal, year, unread, starred, has-PDF, source, author), sorting, pagination.
- CJK LIKE fallback.
- AI assistant threads/messages with citations mapped to library articles; summaries, comparison, trends, related papers, library question answering.
- Offline extractive/statistical fallback with explicit “local mode” notice; no fabricated references.
- Full-text-to-assistant toggle with privacy hint.

#### Data & settings
- BibTeX, RIS, CSV, JSON export; BibTeX/RIS/JSON import; JSON category reconstruction.
- Full backup ZIP (DB snapshot without plaintext/ciphertext API key + managed PDFs + manifest) and validated restore with pre-restore snapshot and relaunch.
- Daily automatic database snapshots, 7-day retention.
- Dashboard metrics, classification distribution, source breakdown, review queue, sync status.
- Bilingual Chinese/English UI, light/dark/system theme, settings persistence.
- Stale job/sync cleanup at startup; database vacuum; data-folder shortcuts.

#### Engineering
- Electron 45 + React 19 + TypeScript + Vite 8 + Tailwind 4, no native modules.
- 24-table normalized schema with versioned migrations, WAL, foreign keys, partial unique indexes.
- Typed preload API, context isolation, sandbox, CSP, zod IPC validation.
- 29 Vitest tests + 5 Playwright Electron E2E tests.
- 10,000-reference performance test (FTS ≈5–9 ms).
- Windows NSIS installer and portable build via electron-builder.
- Documentation: README, ARCHITECTURE, DATABASE, DEVELOPMENT, TODO, AI_CLASSIFICATION, CHANGELOG.

### Fixed during development
- FTS search query was missing its `MATCH` clause (parameter/column mismatch).
- Feed ETag/Last-Modified were not hydrated into subscription objects, breaking 304 responses.
- Journals without ISSN could not be created by manual RSS subscription.
- PDF document cleanup called a non-existent `destroy()` on pdf.js v6 document proxies, blanking the renderer on navigation; now destroys the loading task safely and has an ErrorBoundary.
- PDF abstract extraction failed on single-line page text; citation line now yields journal/volume/issue/pages.
- AI confidence out-of-range values were defaulted instead of clamped.
- API key could be echoed into settings JSON during update; now stripped before persistence.
- Archiver v8 ESM-only API handled via `ZipArchive` class.
- Misleading “recent” filter label wrapping in the Discover sidebar.

### Known limitations
- Installer unsigned; macOS/Linux targets not built.
- No OCR for scanned PDFs.
- Zotero import and vector search remain extension points.
- Live external metadata APIs are runtime-optional and can rate-limit.
