# AI Classification Design

This document describes how LiteratureX turns a paper into multi-label assignments in the user's own taxonomy, including prompts, validation, thresholds, manual-override rules, versioning, and the offline fallback.

## 1. Principles

1. **The taxonomy is user-owned.** The model may only use category UUIDs supplied in the request; unknown IDs are discarded.
2. **Multi-label by design.** A paper may belong to several branches (e.g. *Mass Spectrometry / MS/MS* and *AI / Deep Learning*).
3. **Evidence over prose.** Every assignment carries evidence, matched keywords, a reasoning sentence, and a calibrated confidence.
4. **Human decisions are immutable.** A user-accepted, user-added, or user-rejected assignment is never overwritten by AI.
5. **Consistency across sources.** RSS articles, PDF-imported papers, manual references, and DOI imports all pass through the same `ClassifierService` with a standardized record.
6. **No fabricated metadata or citations.** Missing values stay missing and are flagged for review.
7. **Offline capability.** Without an API key the local heuristic classifier produces the same structured shape, so the whole workflow remains functional.

## 2. Standardized input

The classifier consumes a source-independent record:

```ts
interface ClassificationRequest {
  title: string
  abstract?: string | null
  journal?: string | null
  year?: number | null
  doi?: string | null
  keywords?: string[]
  fulltext?: string | null   // only when the user enabled full-text sending
  language: 'zh' | 'en'
  taxonomy: TaxonomyNode[]
}
```

`TaxonomyNode` contains only active categories:

```ts
{
  id, name, path, description, instructions, priority,
  keywords: string[],   // kind = keyword
  synonyms: string[]    // kind = synonym
}
```

Full text is truncated to 60,000 characters for classification; the prompt includes at most 45,000 characters of the paper. If `ai.sendFullText` is off (default), only title/abstract/keywords/metadata are sent.

## 3. Provider selection

`createProvider(config)` implements the policy:

| Mode | Behaviour |
|---|---|
| `auto` (default) | Use the OpenAI-compatible provider when both API key and model are set; otherwise local heuristic |
| `openai` | Require key + model; otherwise throw a configuration error |
| `heuristic` | Always local; no network |

`AiProvider` interface:

```ts
classify(request): Promise<{ raw, rawText, model }>
chat(messages, options?): Promise<string>
testConnection(): Promise<string>
```

The provider used, model name, and prompt version are stored with each result.

## 4. Remote prompt

Prompt version: **`2026-11-09.v1`** (`CLASSIFIER_PROMPT_VERSION`).

System message (abridged; the full text lives in `src/main/services/ai/providers.ts`):

```
You are a meticulous scientific literature classifier for a researcher's personal library.
Assign the paper to zero or more categories from the user's taxonomy.
The taxonomy is user-defined and authoritative — never invent category ids.

1. MULTI-LABEL...
2. Use only category_id values that appear in the provided taxonomy...
3. confidence is calibrated 0..1...
4. evidence must quote or closely paraphrase specific text...
5. matched_keywords must be terms actually present...
6. reasoning is one short sentence...
7. summary is 1-2 sentences in <language>...
8. research_topics: 3-8 concise topics in <language>...
9. unmatched_topics: topics the taxonomy does not represent well...
10. needs_human_review is true when ambiguous...
11. If nothing matches, return classifications: [] and explain in summary.

Return STRICT JSON only...
```

User message contains two JSON blocks:

```
TAXONOMY: [ {category_id, path, description, keywords, synonyms, instructions, priority}, ... ]

PAPER: {title, journal, year, doi, keywords, abstract, fulltext_excerpt}
```

The request uses `response_format: { type: 'json_object' }` when supported; on providers that reject it, the client retries once without the flag and extracts the JSON object from the response. Responses wrapped in Markdown code fences are accepted.

## 5. Required JSON shape

```json
{
  "classifications": [
    {
      "category_id": "uuid",
      "confidence": 0.91,
      "evidence": "The paper develops a graph neural network for MS/MS spectral prediction.",
      "matched_keywords": ["deep learning", "MS/MS"],
      "reasoning": "The core contribution directly matches this category."
    }
  ],
  "summary": "A concise description of the paper.",
  "research_topics": ["MS/MS prediction", "deep learning"],
  "unmatched_topics": ["A potentially new research direction"],
  "needs_human_review": false
}
```

### Validation pipeline

1. Strip code fences; locate the outermost `{...}`.
2. `JSON.parse`; on failure record an error and surface a friendly message.
3. Validate with zod:
   - `classifications[]` objects; confidence coerced and **clamped to [0,1]**;
   - strings/arrays default safely on malformed fields;
   - `needs_human_review` defaults false.
4. Drop category IDs not present in the active taxonomy.
5. De-duplicate by category (keep highest confidence), sort descending, cap at 12 assignments.
6. Truncate summary to 1,500 chars; topics to 15 items; evidence 1,200; reasoning 800.

## 6. Confidence thresholds

Defaults (settings): `high = 0.78`, `medium = 0.52`.

| Confidence | Status | Behavior |
|---|---|---|
| `>= high` | `auto` | Assigned to the article/collection |
| `medium <= c < high` | `provisional` | Assigned provisionally, counted in review queue |
| `< medium` | `needs_review` | Shown as needing review; article flagged |
| user action | `confirmed` / `rejected` | `decided_by='user'`, protected from AI |

Article-level `needs_review` is true when the model requests human review **or** any assignment is provisional/needs_review. Thresholds are editable in Settings.

## 7. Persistence and audit

For each run:

- `ai_classifications`: provider, model, prompt version, raw response, parsed JSON, status/error, duration, thresholds used.
- `article_categories`: one row per article/category with source, confidence, evidence, reasoning, matched keywords, status, `decided_by`, model/prompt version.
- `classification_history`: append-only action log (`assigned`, `removed`, `reclassified`, `manual_add`, `rejected`, `accepted`) with actor and before/after JSON.
- `articles.last_classified_at`, `ai_summary`, `needs_review`, keywords merged from `research_topics`.

The article AI tab displays assignments, confidence bars, evidence, matched keywords, accept/reject controls, and a collapsible classification history.

## 8. Manual override algorithm

`ArticleRepo.applyAiClassification`:

1. Load all existing rows for the article.
2. For every AI result:
   - if an existing row has `source='manual'` **or** `decided_by='user'`, keep it and increment `preservedManual`;
   - otherwise insert or update as AI (`decided_by='ai'`).
3. Delete stale AI rows not present in the new result only when `source='ai' AND decided_by='ai'`.
4. Update summary/needs-review, merge research topics into keywords.
5. Write history entries for each change.
6. Refresh FTS.

Consequences:

- Re-running classification, changing providers, syncing the feed again, or “reclassify entire library” cannot resurrect a rejected category or overwrite a manual category.
- Users can still remove a previously accepted manual category via the UI; that writes a user rejection.
- Batch reclassification uses `force=true` but still respects the invariant.

## 9. Local heuristic classifier

The fallback is deterministic and explainable.

### Category term construction

- Category name, each path segment, and each keyword → weight `1.0`.
- Synonyms → weight `0.6`.
- Term length factor: `min(2.2, 1 + 0.25 × wordCount)`.

### Scoring

For each term present in the paper:

| Field | Weight |
|---|---|
| Title | ×4 |
| Keywords | ×3 |
| Abstract | ×2 |
| Full text | ×0.6 |

Score is the sum over terms; category `priority` adds up to +1. Terms with score ≥ 0.9 become candidates; top 6 categories are returned.

Confidence: `min(0.93, 0.38 + ln(1 + score) / 3.1)`; clamped to [0,1] and rounded to 3 decimals.

- Evidence: the first abstract sentence containing a matched term, else the title.
- Summary: first two abstract sentences (or title).
- Research topics: matched terms (top 8).
- `needs_human_review` when no matches.
- Unmatched topics are left empty; taxonomy suggestions fall back to extracted keywords.

The heuristic never calls the network and never invents evidence.

## 10. Taxonomy improvement suggestions

Sources:

- AI runs store `unmatched_topics`; recent values are aggregated from `ai_classifications.parsed_json`.
- If no AI data exists, keywords from articles awaiting review are counted.

When the user clicks **Analyze and suggest**:

- If a remote provider is configured, it receives the current taxonomy (ids/paths/keywords) + top uncategorized topics and returns at most 5 suggestions of types `new_subcategory`, `new_keyword`, `missing_topic`, or `merge`.
- Otherwise the local fallback proposes missing topics that appear ≥2 times.

Suggestions are persisted in `category_suggestions` with status `pending`. Accepting:

- `new_subcategory`/`missing_topic` → creates a category under the chosen parent with keywords;
- `new_keyword` → appends keywords to the parent category;
- `merge` → marks accepted only; merging is never automatic.

The AI never edits the taxonomy by itself.

## 11. Consistency across RSS and PDF

All sources are normalized to the same article record and passed to the same service. Deduplication by DOI/dedup key means an RSS article and a PDF of the same paper share one record; the second source only fills missing fields. Therefore a paper cannot receive contradictory categories just because it entered through another path.

## 12. Versioning

Tracked per run: provider, model, `CLASSIFIER_PROMPT_VERSION`, threshold values, raw/parsed output, duration. Taxonomy changes do not auto-reclassify; the user chooses:

- reclassify one paper,
- reclassify selected papers,
- reclassify a category's papers,
- reclassify the entire library.

These run through the job queue with progress events.

## 13. Failure handling

- Network errors, 401/404/429/5xx, timeouts, invalid JSON, schema violations → recorded in `ai_classifications` with status `error` and surfaced as a toast.
- Retry once for 429/5xx/network in the OpenAI client; RSS/metadata HTTP uses up to two retries.
- The local heuristic remains available immediately (switch mode or remove the key).
- If no active categories exist, classification is refused with a clear message instead of guessing.

## 14. Privacy

- Default `ai.sendFullText = false`; only title/abstract/keywords/metadata are sent.
- Assistant full text has a separate switch (`assistant.sendFullText`, default false).
- Notes are never sent.
- API keys are encrypted with OS secure storage and never exposed to the renderer or logs.
- Classification requests go only to the user-configured endpoint.

## 15. Testing

- Heuristic classification without a key (integration).
- OpenAI-compatible provider with mocked HTTP: JSON mode, fenced JSON, confidence clamping, unknown ID filtering, invalid JSON error path.
- Manual category preservation and rejected-category blocking across reruns.
- Threshold status mapping.
- 10,000-reference FTS/list performance.
- End-to-end: create taxonomy → import PDF → classify → manual correction → search → restart.
