import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  Category,
  CategoryInput,
  CategoryKeyword,
  CategoryKeywordInput,
  CategoryMergeInput,
  CategoryPatch,
  TaxonomySuggestion
} from '@shared/types'
import type { AppDatabase } from '../database'

interface CategoryRow {
  id: string
  parent_id: string | null
  name: string
  description: string | null
  instructions: string | null
  color: string | null
  icon: string | null
  priority: number
  is_active: number
  sort_order: number
  created_at: string
  updated_at: string
}

export type { CategoryInput, CategoryPatch, CategoryKeywordInput } from '@shared/types'

function nowIso(): string {
  return new Date().toISOString()
}

export class CategoryRepo {
  constructor(
    private readonly database: AppDatabase,
    private readonly onAssignmentsChanged: (articleIds: string[]) => void = () => {}
  ) {}

  private get db(): DatabaseSync {
    return this.database.db
  }

  listFlat(): Category[] {
    const rows = this.db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as unknown as CategoryRow[]
    const keywords = this.db
      .prepare('SELECT * FROM category_keywords ORDER BY weight DESC, keyword')
      .all() as Array<{
      id: string
      category_id: string
      keyword: string
      keyword_en: string | null
      keyword_zh: string | null
      kind: 'keyword' | 'synonym'
      weight: number
    }>
    const counts = this.db
      .prepare(
        "SELECT category_id, COUNT(DISTINCT article_id) AS c FROM article_categories WHERE status != 'rejected' GROUP BY category_id"
      )
      .all() as Array<{ category_id: string; c: number }>
    const keywordBy = new Map<string, CategoryKeyword[]>()
    for (const row of keywords) {
      const list = keywordBy.get(row.category_id) ?? []
      list.push({
        id: row.id,
        categoryId: row.category_id,
        keyword: row.keyword,
        keywordEn: row.keyword_en,
        keywordZh: row.keyword_zh,
        kind: row.kind,
        weight: row.weight
      })
      keywordBy.set(row.category_id, list)
    }
    const countBy = new Map(counts.map((row) => [row.category_id, row.c]))
    const paths = this.paths(rows)
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      description: row.description,
      instructions: row.instructions,
      color: row.color,
      icon: row.icon,
      priority: row.priority,
      isActive: row.is_active === 1,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      keywords: keywordBy.get(row.id) ?? [],
      articleCount: countBy.get(row.id) ?? 0,
      path: paths.get(row.id)?.path ?? row.name
    }))
  }

  tree(): Category[] {
    const flat = this.listFlat()
    const byId = new Map(flat.map((category) => [category.id, { ...category, children: [] as Category[] }]))
    const roots: Category[] = []
    for (const category of byId.values()) {
      if (category.parentId && byId.has(category.parentId)) byId.get(category.parentId)!.children!.push(category)
      else roots.push(category)
    }
    const sort = (items: Category[]): void => {
      items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      for (const item of items) if (item.children) sort(item.children)
    }
    sort(roots)
    return roots
  }

  private paths(rows: CategoryRow[]): Map<string, { path: string; name: string }> {
    const byId = new Map(rows.map((row) => [row.id, row]))
    const cache = new Map<string, { path: string; name: string }>()
    const resolve = (id: string, seen: Set<string>): string => {
      if (seen.has(id)) return ''
      const row = byId.get(id)
      if (!row) return ''
      seen.add(id)
      const parent = row.parent_id ? resolve(row.parent_id, seen) : ''
      return parent ? `${parent} / ${row.name}` : row.name
    }
    for (const row of rows) cache.set(row.id, { path: resolve(row.id, new Set()), name: row.name })
    return cache
  }

  get(id: string): Category | null {
    return this.listFlat().find((category) => category.id === id) ?? null
  }

  descendantIds(id: string): string[] {
    const rows = this.db.prepare('SELECT id, parent_id FROM categories').all() as Array<{ id: string; parent_id: string | null }>
    const children = new Map<string, string[]>()
    for (const row of rows) {
      if (!row.parent_id) continue
      const list = children.get(row.parent_id) ?? []
      list.push(row.id)
      children.set(row.parent_id, list)
    }
    const result: string[] = []
    const stack = [id]
    const seen = new Set<string>()
    while (stack.length) {
      const current = stack.pop() as string
      if (seen.has(current)) continue
      seen.add(current)
      result.push(current)
      for (const child of children.get(current) ?? []) stack.push(child)
    }
    return result
  }

  create(input: CategoryInput): Category {
    return this.database.transaction(() => {
      const name = input.name.trim()
      if (!name) throw new Error('Category name is required')
      if (input.parentId && !this.get(input.parentId)) throw new Error('Parent category not found')
      const id = randomUUID()
      const timestamp = nowIso()
      this.db
        .prepare(
          `INSERT INTO categories (id, parent_id, name, description, instructions, color, icon, priority, is_active, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.parentId ?? null,
          name,
          input.description ?? null,
          input.instructions ?? null,
          input.color ?? null,
          input.icon ?? null,
          input.priority ?? 0,
          input.isActive === false ? 0 : 1,
          input.sortOrder ?? 0,
          timestamp,
          timestamp
        )
      this.setKeywords(id, input.keywords ?? [])
      return this.get(id) as Category
    })
  }

  update(id: string, patch: CategoryPatch): Category {
    return this.database.transaction(() => {
      const current = this.get(id)
      if (!current) throw new Error('Category not found')
      if (patch.parentId !== undefined && patch.parentId) {
        if (patch.parentId === id) throw new Error('A category cannot be its own parent')
        if (this.descendantIds(id).includes(patch.parentId)) throw new Error('Cannot move a category under its own descendant')
      }
      const sets: string[] = []
      const values: Array<string | number | null> = []
      if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (!name) throw new Error('Category name is required')
        sets.push('name = ?')
        values.push(name)
      }
      if (patch.parentId !== undefined) {
        sets.push('parent_id = ?')
        values.push(patch.parentId)
      }
      if (patch.description !== undefined) {
        sets.push('description = ?')
        values.push(patch.description)
      }
      if (patch.instructions !== undefined) {
        sets.push('instructions = ?')
        values.push(patch.instructions)
      }
      if (patch.color !== undefined) {
        sets.push('color = ?')
        values.push(patch.color)
      }
      if (patch.icon !== undefined) {
        sets.push('icon = ?')
        values.push(patch.icon)
      }
      if (patch.priority !== undefined) {
        sets.push('priority = ?')
        values.push(patch.priority)
      }
      if (patch.isActive !== undefined) {
        sets.push('is_active = ?')
        values.push(patch.isActive ? 1 : 0)
      }
      if (patch.sortOrder !== undefined) {
        sets.push('sort_order = ?')
        values.push(patch.sortOrder)
      }
      if (sets.length) {
        sets.push('updated_at = ?')
        values.push(nowIso())
        values.push(id)
        this.db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).run(...values)
      }
      if (patch.keywords !== undefined) this.setKeywords(id, patch.keywords)
      const articleIds = this.articleIdsForCategories(this.descendantIds(id))
      this.onAssignmentsChanged(articleIds)
      return this.get(id) as Category
    })
  }

  delete(id: string): void {
    this.database.transaction(() => {
      const ids = this.descendantIds(id)
      const articleIds = this.articleIdsForCategories(ids)
      this.db.prepare('DELETE FROM categories WHERE id = ?').run(id)
      this.onAssignmentsChanged(articleIds)
    })
  }

  merge(sourceIds: string[], input: CategoryMergeInput): Category {
    return this.database.transaction(() => {
      const ids = [...new Set(sourceIds)]
      if (ids.length < 2) throw new Error('Select at least two categories to merge')
      const name = input.name.trim()
      if (!name) throw new Error('Category name is required')
      const sources = ids.map((id) => this.get(id))
      if (sources.some((category) => !category)) throw new Error('Category not found')
      const valid = sources as Category[]
      const sourceSet = new Set(ids)
      const parents = new Set(valid.map((category) => category.parentId ?? null))
      const commonParent = parents.size === 1 ? [...parents][0] : null
      const parentId = commonParent && !sourceSet.has(commonParent) ? commonParent : null

      const keywordMap = new Map<string, CategoryKeywordInput>()
      for (const category of valid) {
        for (const keyword of category.keywords) {
          const primary = keyword.keyword || keyword.keywordEn || keyword.keywordZh || ''
          const key = `${primary.toLowerCase()}|${keyword.kind}`
          if (!primary || keywordMap.has(key)) continue
          keywordMap.set(key, {
            keyword: keyword.keyword,
            keywordEn: keyword.keywordEn,
            keywordZh: keyword.keywordZh,
            kind: keyword.kind,
            weight: keyword.weight
          })
        }
      }
      for (const keyword of input.keywords ?? []) {
        const trimmed = keyword.trim()
        if (!trimmed) continue
        const key = `${trimmed.toLowerCase()}|keyword`
        if (!keywordMap.has(key)) keywordMap.set(key, { keyword: trimmed })
      }

      const target = this.create({
        name,
        parentId,
        description: input.description ?? valid.find((category) => category.description)?.description ?? null,
        color: valid.find((category) => category.color)?.color ?? null,
        priority: Math.max(0, ...valid.map((category) => category.priority)),
        isActive: valid.some((category) => category.isActive),
        keywords: [...keywordMap.values()]
      })

      const rows = this.db
        .prepare(
          `SELECT * FROM article_categories WHERE category_id IN (${ids.map(() => '?').join(',')}) AND status != 'rejected'`
        )
        .all(...ids) as Array<{
        article_id: string
        source: string
        confidence: number
        evidence: string | null
        reasoning: string | null
        matched_keywords: string | null
        status: string
        decided_by: string
        model: string | null
        prompt_version: string | null
        created_at: string
      }>
      const rank = (row: (typeof rows)[number]): number => {
        const decision = row.decided_by === 'user' ? 100 : 0
        const status =
          row.status === 'confirmed' ? 10 : row.status === 'auto' ? 5 : row.status === 'provisional' ? 3 : 1
        return decision + status + row.confidence
      }
      const best = new Map<string, (typeof rows)[number]>()
      for (const row of rows) {
        const current = best.get(row.article_id)
        if (!current || rank(row) > rank(current)) best.set(row.article_id, row)
      }
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO article_categories
          (id, article_id, category_id, source, confidence, evidence, reasoning, matched_keywords, status, decided_by, model, prompt_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const timestamp = nowIso()
      for (const row of best.values()) {
        insert.run(
          randomUUID(),
          row.article_id,
          target.id,
          row.source,
          row.confidence,
          row.evidence,
          row.reasoning,
          row.matched_keywords,
          row.status,
          row.decided_by,
          row.model,
          row.prompt_version,
          row.created_at,
          timestamp
        )
      }
      this.db.prepare(`DELETE FROM article_categories WHERE category_id IN (${ids.map(() => '?').join(',')})`).run(...ids)

      const keepPlaceholders = ids.map(() => '?').join(',')
      for (const id of ids) {
        this.db
          .prepare(`UPDATE categories SET parent_id = ?, updated_at = ? WHERE parent_id = ? AND id NOT IN (${keepPlaceholders})`)
          .run(target.id, timestamp, id, ...ids)
      }
      this.db.prepare(`DELETE FROM categories WHERE id IN (${keepPlaceholders})`).run(...ids)
      this.onAssignmentsChanged([...best.keys()])
      return this.get(target.id) as Category
    })
  }

  setKeywords(categoryId: string, keywords: CategoryKeywordInput[]): void {
    this.db.prepare('DELETE FROM category_keywords WHERE category_id = ?').run(categoryId)
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO category_keywords (id, category_id, keyword, keyword_en, keyword_zh, kind, weight) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (const item of keywords) {
      const keyword = item.keyword.trim()
      const keywordEn = item.keywordEn?.trim() || null
      const keywordZh = item.keywordZh?.trim() || null
      const primary = keyword || keywordEn || keywordZh
      if (!primary) continue
      insert.run(randomUUID(), categoryId, primary, keywordEn, keywordZh, item.kind ?? 'keyword', item.weight ?? 1)
    }
  }

  articleIdsForCategories(categoryIds: string[]): string[] {
    if (!categoryIds.length) return []
    const placeholders = categoryIds.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT DISTINCT article_id FROM article_categories WHERE category_id IN (${placeholders})`)
      .all(...categoryIds) as Array<{ article_id: string }>
    return rows.map((row) => row.article_id)
  }

  listSuggestions(status?: TaxonomySuggestion['status']): TaxonomySuggestion[] {
    const rows = (
      status
        ? this.db.prepare('SELECT * FROM category_suggestions WHERE status = ? ORDER BY created_at DESC').all(status)
        : this.db.prepare('SELECT * FROM category_suggestions ORDER BY created_at DESC').all()
    ) as Array<{
      id: string
      type: TaxonomySuggestion['type']
      title: string
      rationale: string | null
      payload_json: string | null
      evidence: string | null
      status: TaxonomySuggestion['status']
      created_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      rationale: row.rationale ?? '',
      payload: row.payload_json ? JSON.parse(row.payload_json) : {},
      evidence: row.evidence ?? '',
      status: row.status,
      createdAt: row.created_at
    }))
  }

  createSuggestion(input: {
    type: TaxonomySuggestion['type']
    title: string
    rationale: string
    payload: TaxonomySuggestion['payload']
    evidence: string
  }): TaxonomySuggestion {
    const id = randomUUID()
    this.db
      .prepare(
        "INSERT INTO category_suggestions (id, type, title, rationale, payload_json, evidence, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
      )
      .run(id, input.type, input.title, input.rationale, JSON.stringify(input.payload), input.evidence, nowIso())
    return this.listSuggestions().find((item) => item.id === id) as TaxonomySuggestion
  }

  setSuggestionStatus(id: string, status: TaxonomySuggestion['status']): void {
    this.db.prepare('UPDATE category_suggestions SET status = ? WHERE id = ?').run(status, id)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number }
    return row.c
  }
}
