# TODO

## Office / WPS add-in
- [ ] End-to-end test the Word add-in in a machine with Microsoft Word (sideload + certificate trust + citation insertion).
- [ ] Verify the WPS ribbon/task pane in a clean WPS install; add a fallback if file:// → http:// fetch is blocked by an enterprise policy.
- [ ] Add a Word ribbon command (VersionOverrides) so the add-in is one click from the Home tab.
- [ ] Add a certificate removal/uninstall helper for the Word local TLS certificate.
- [ ] Add author-year sorting/citation style templates (APA/MLA/GB/T 7714) beyond the simple numeric/author-year formats.
- [ ] Add “insert selected references without citing” and update/refresh existing bibliography blocks.

## Packaging & distribution
- [ ] Code-sign the Windows installer (EV/OV certificate) and document SmartScreen behavior.
- [ ] Add macOS build (universal binary, notarization, `.icns`) and Linux AppImage/deb targets with icons.
- [ ] Add auto-update channel and release notes plumbing.
- [ ] Add a portable-data mode (`--user-data-dir` CLI switch) documented for USB usage.

## Literature and metadata
- [ ] Zotero library import (SQLite/JSON) using the existing normalized model.
- [ ] EndNote/RefWorks/Mendeley importers.
- [ ] Scanned-PDF OCR (optional local Tesseract sidecar) with per-page confidence.
- [ ] Better journal homepage discovery when Crossref has no homepage (ISSN resolver fallbacks).
- [ ] More publisher RSS templates and a user-maintained template file.
- [ ] Citation graph / references extraction and “cited by” metadata.
- [ ] DOI correction suggestions when extracted DOI is invalid or mismatched.

## AI classification
- [ ] Few-shot examples per category (stored instructions already supported).
- [ ] Embedding-assisted candidate narrowing for very large taxonomies (>200 categories).
- [ ] Duplicate/merge detection between categories with a preview workflow.
- [ ] Active learning: prioritize uncertain papers for review.
- [ ] Per-task provider/model selection (classification vs assistant vs embeddings).
- [ ] Token/cost accounting per classification run.
- [ ] Optional local model presets (Ollama/vLLM) with connectivity checks.

## Search & assistant
- [ ] Semantic/vector search with hybrid reranking (extension point documented in ARCHITECTURE).
- [ ] Saved searches and smart collections.
- [ ] Assistant streaming responses and cancel button.
- [ ] Assistant tool calls for structured library queries (filters, counts, exports).
- [ ] Conversation export (Markdown/PDF) and shareable citation bundles.

## UX and quality
- [ ] Keyboard command palette (Cmd/Ctrl+K) and list navigation shortcuts.
- [ ] Drag-and-drop category reordering and drag articles onto collections.
- [ ] Bulk editing of metadata fields.
- [ ] Accessibility audit (focus order, ARIA on icon-only controls, contrast).
- [ ] Virtualized long lists for 50k+ libraries.
- [ ] In-app onboarding tour and sample taxonomy import.
- [ ] Rich charts for trends/publication venues.

## Engineering
- [ ] Live API contract tests (Crossref/OpenAlex/S2/PubMed/Unpaywall) behind an opt-in env flag.
- [ ] Crash reporting/structured local logs with rotation (privacy-preserving, opt-in).
- [ ] Add a migration upgrade test that opens a v1 database with a future v2 migration.
- [ ] Harden restore against custom managed-PDF paths.
- [ ] Add `npm run lint` (ESLint/oxlint) and formatting check.
- [ ] Reduce renderer bundle by lazy-loading pdfjs and the assistant page.
- [ ] Add CI workflow for typecheck/tests/E2E on Windows.
