import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Journal, RssFeed, Subscription, SubscriptionGroup, SyncHistoryEntry } from '@shared/types'
import type { AppDatabase } from '../database'

interface SubscriptionRow {
  id: string
  feed_id: string
  journal_id: string | null
  group_id: string | null
  name: string | null
  enabled: number
  interval_minutes: number
  last_sync_at: string | null
  created_at: string
  feed_url: string
  feed_title: string | null
  feed_site_url: string | null
  feed_status: string | null
  feed_error: string | null
  feed_etag: string | null
  feed_last_modified: string | null
  feed_fetched_at: string | null
  feed_discovered_by: string | null
  feed_item_count: number | null
  journal_title: string | null
  journal_issn: string | null
  journal_eissn: string | null
  journal_publisher: string | null
  journal_homepage: string | null
  journal_created_at: string | null
  group_name: string | null
  group_color: string | null
  group_sort: number | null
  unread_count: number
}

function nowIso(): string {
  return new Date().toISOString()
}

export interface JournalInput {
  title: string
  issn?: string | null
  eissn?: string | null
  publisher?: string | null
  homepageUrl?: string | null
}

export interface FeedInput {
  url: string
  journalId?: string | null
  title?: string | null
  siteUrl?: string | null
  discoveredBy?: string | null
}

export class SubscriptionRepo {
  constructor(
    private readonly database: AppDatabase,
    private readonly notify: (type: 'subscriptions:changed', payload?: unknown) => void = () => {}
  ) {}

  private get db(): DatabaseSync {
    return this.database.db
  }

  findJournal(issn?: string | null, eissn?: string | null): Journal | null {
    if (!issn && !eissn) return null
    const row = this.db
      .prepare(
        `SELECT * FROM journals WHERE (? IS NOT NULL AND issn = ?) OR (? IS NOT NULL AND eissn = ?) LIMIT 1`
      )
      .get(issn ?? null, issn ?? null, eissn ?? null, eissn ?? null) as
      | {
          id: string
          title: string
          issn: string | null
          eissn: string | null
          publisher: string | null
          homepage_url: string | null
          created_at: string
        }
      | undefined
    return row ? this.mapJournal(row) : null
  }

  private mapJournal(row: {
    id: string
    title: string
    issn: string | null
    eissn: string | null
    publisher: string | null
    homepage_url: string | null
    created_at: string
  }): Journal {
    return {
      id: row.id,
      title: row.title,
      issn: row.issn,
      eissn: row.eissn,
      publisher: row.publisher,
      homepageUrl: row.homepage_url,
      createdAt: row.created_at
    }
  }

  private findJournalByTitle(title: string): Journal | null {
    const row = this.db.prepare('SELECT * FROM journals WHERE lower(title) = lower(?) LIMIT 1').get(title) as
      | {
          id: string
          title: string
          issn: string | null
          eissn: string | null
          publisher: string | null
          homepage_url: string | null
          created_at: string
        }
      | undefined
    return row ? this.mapJournal(row) : null
  }

  upsertJournal(input: JournalInput): Journal {
    const existing = this.findJournal(input.issn, input.eissn) ?? this.findJournalByTitle(input.title)
    if (existing) {
      this.db
        .prepare(
          'UPDATE journals SET title = COALESCE(?, title), publisher = COALESCE(publisher, ?), homepage_url = COALESCE(homepage_url, ?) WHERE id = ?'
        )
        .run(input.title || null, input.publisher ?? null, input.homepageUrl ?? null, existing.id)
      const row = this.db.prepare('SELECT * FROM journals WHERE id = ?').get(existing.id) as Parameters<
        SubscriptionRepo['mapJournal']
      >[0]
      return this.mapJournal(row)
    }
    const id = randomUUID()
    this.db
      .prepare('INSERT INTO journals (id, title, issn, eissn, publisher, homepage_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.title, input.issn ?? null, input.eissn ?? null, input.publisher ?? null, input.homepageUrl ?? null, nowIso())
    const row = this.db.prepare('SELECT * FROM journals WHERE id = ?').get(id) as Parameters<SubscriptionRepo['mapJournal']>[0]
    return this.mapJournal(row)
  }

  findFeedByUrl(url: string): RssFeed | null {
    const row = this.db.prepare('SELECT * FROM rss_feeds WHERE url = ?').get(url) as Record<string, unknown> | undefined
    return row ? this.mapFeed(row) : null
  }

  upsertFeed(input: FeedInput): RssFeed {
    const existing = this.findFeedByUrl(input.url)
    if (existing) {
      this.db
        .prepare(
          'UPDATE rss_feeds SET journal_id = COALESCE(journal_id, ?), title = COALESCE(?, title), site_url = COALESCE(site_url, ?), discovered_by = COALESCE(discovered_by, ?) WHERE id = ?'
        )
        .run(input.journalId ?? null, input.title ?? null, input.siteUrl ?? null, input.discoveredBy ?? null, existing.id)
      return this.findFeedByUrl(input.url) as RssFeed
    }
    const id = randomUUID()
    this.db
      .prepare(
        'INSERT INTO rss_feeds (id, journal_id, url, title, site_url, discovered_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, input.journalId ?? null, input.url, input.title ?? null, input.siteUrl ?? null, input.discoveredBy ?? null, nowIso())
    return this.findFeedByUrl(input.url) as RssFeed
  }

  private mapFeed(row: Record<string, unknown>): RssFeed {
    return {
      id: row.id as string,
      journalId: (row.journal_id as string | null) ?? null,
      url: row.url as string,
      title: (row.title as string | null) ?? null,
      siteUrl: (row.site_url as string | null) ?? null,
      discoveredBy: (row.discovered_by as string | null) ?? null,
      lastFetchedAt: (row.last_fetched_at as string | null) ?? null,
      etag: (row.etag as string | null) ?? null,
      lastModified: (row.last_modified as string | null) ?? null,
      lastStatus: (row.last_status as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
      lastItemCount: (row.last_item_count as number | null) ?? null,
      createdAt: row.created_at as string
    }
  }

  updateFeedState(
    feedId: string,
    state: {
      etag?: string | null
      lastModified?: string | null
      lastStatus?: string | null
      lastError?: string | null
      lastItemCount?: number | null
      fetchedAt?: string | null
    }
  ): void {
    this.db
      .prepare(
        `UPDATE rss_feeds SET
          etag = COALESCE(?, etag),
          last_modified = COALESCE(?, last_modified),
          last_status = COALESCE(?, last_status),
          last_error = ?,
          last_item_count = COALESCE(?, last_item_count),
          last_fetched_at = COALESCE(?, last_fetched_at)
         WHERE id = ?`
      )
      .run(
        state.etag ?? null,
        state.lastModified ?? null,
        state.lastStatus ?? null,
        state.lastError ?? null,
        state.lastItemCount ?? null,
        state.fetchedAt ?? null,
        feedId
      )
  }

  list(): Subscription[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, f.url AS feed_url, f.title AS feed_title, f.site_url AS feed_site_url,
                f.last_status AS feed_status, f.last_error AS feed_error,
                f.etag AS feed_etag, f.last_modified AS feed_last_modified, f.last_fetched_at AS feed_fetched_at,
                f.discovered_by AS feed_discovered_by, f.last_item_count AS feed_item_count,
                j.title AS journal_title, j.issn AS journal_issn, j.eissn AS journal_eissn,
                j.publisher AS journal_publisher, j.homepage_url AS journal_homepage, j.created_at AS journal_created_at,
                sg.name AS group_name, sg.color AS group_color, sg.sort_order AS group_sort,
                (SELECT COUNT(*) FROM articles a WHERE a.subscription_id = s.id AND a.deleted_at IS NULL AND a.read_status = 'unread') AS unread_count
         FROM subscriptions s
         JOIN rss_feeds f ON f.id = s.feed_id
         LEFT JOIN journals j ON j.id = s.journal_id
         LEFT JOIN subscription_groups sg ON sg.id = s.group_id
         ORDER BY COALESCE(j.title, f.title, s.name) COLLATE NOCASE`
      )
      .all() as unknown as SubscriptionRow[]
    return rows.map((row) => this.mapSubscription(row))
  }

  get(id: string): Subscription | null {
    return this.list().find((item) => item.id === id) ?? null
  }

  private mapSubscription(row: SubscriptionRow): Subscription {
    return {
      id: row.id,
      feedId: row.feed_id,
      journalId: row.journal_id,
      groupId: row.group_id,
      name: row.name ?? undefined,
      enabled: row.enabled === 1,
      intervalMinutes: row.interval_minutes,
      lastSyncAt: row.last_sync_at,
      createdAt: row.created_at,
      journal: row.journal_id
        ? {
            id: row.journal_id,
            title: row.journal_title ?? '',
            issn: row.journal_issn,
            eissn: row.journal_eissn,
            publisher: row.journal_publisher,
            homepageUrl: row.journal_homepage,
            createdAt: row.journal_created_at ?? row.created_at
          }
        : null,
      feed: {
        id: row.feed_id,
        journalId: row.journal_id,
        url: row.feed_url,
        title: row.feed_title,
        siteUrl: row.feed_site_url,
        discoveredBy: row.feed_discovered_by,
        lastFetchedAt: row.feed_fetched_at,
        etag: row.feed_etag,
        lastModified: row.feed_last_modified,
        lastStatus: row.feed_status,
        lastError: row.feed_error,
        lastItemCount: row.feed_item_count,
        createdAt: row.created_at
      },
      group: row.group_id
        ? {
            id: row.group_id,
            name: row.group_name ?? '',
            color: row.group_color,
            sortOrder: row.group_sort ?? 0,
            createdAt: row.created_at
          }
        : null,
      unreadCount: row.unread_count
    }
  }

  create(input: {
    feedUrl: string
    feedTitle?: string
    journalTitle?: string
    issn?: string | null
    eissn?: string | null
    publisher?: string | null
    homepageUrl?: string | null
    name?: string
    groupId?: string | null
    intervalMinutes?: number
    discoveredBy?: string
  }): Subscription {
    return this.database.transaction(() => {
      const journal = this.upsertJournal({
        title: input.journalTitle || input.feedTitle || input.feedUrl,
        issn: input.issn,
        eissn: input.eissn,
        publisher: input.publisher,
        homepageUrl: input.homepageUrl
      })
      const feed = this.upsertFeed({
        url: input.feedUrl,
        journalId: journal.id,
        title: input.feedTitle,
        siteUrl: input.homepageUrl,
        discoveredBy: input.discoveredBy
      })
      const existing = this.db.prepare('SELECT id FROM subscriptions WHERE feed_id = ?').get(feed.id) as { id: string } | undefined
      if (existing) {
        this.db
          .prepare('UPDATE subscriptions SET name = COALESCE(?, name), group_id = COALESCE(?, group_id), interval_minutes = ? WHERE id = ?')
          .run(input.name ?? null, input.groupId ?? null, input.intervalMinutes ?? 60, existing.id)
        this.notify('subscriptions:changed', { id: existing.id })
        return this.get(existing.id) as Subscription
      }
      const id = randomUUID()
      this.db
        .prepare(
          'INSERT INTO subscriptions (id, journal_id, feed_id, name, group_id, enabled, interval_minutes, last_sync_at, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?)'
        )
        .run(id, journal.id, feed.id, input.name ?? null, input.groupId ?? null, input.intervalMinutes ?? 60, nowIso())
      this.notify('subscriptions:changed', { id })
      return this.get(id) as Subscription
    })
  }

  update(
    id: string,
    patch: { name?: string | null; groupId?: string | null; enabled?: boolean; intervalMinutes?: number }
  ): Subscription | null {
    const sets: string[] = []
    const values: Array<string | number | null> = []
    if (patch.name !== undefined) {
      sets.push('name = ?')
      values.push(patch.name)
    }
    if (patch.groupId !== undefined) {
      sets.push('group_id = ?')
      values.push(patch.groupId)
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?')
      values.push(patch.enabled ? 1 : 0)
    }
    if (patch.intervalMinutes !== undefined) {
      sets.push('interval_minutes = ?')
      values.push(Math.max(5, patch.intervalMinutes))
    }
    if (sets.length) {
      values.push(id)
      this.db.prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ?`).run(...values)
      this.notify('subscriptions:changed', { id })
    }
    return this.get(id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
    this.notify('subscriptions:changed', { id })
  }

  setLastSync(id: string, at = nowIso()): void {
    this.db.prepare('UPDATE subscriptions SET last_sync_at = ? WHERE id = ?').run(at, id)
  }

  due(now = new Date()): Subscription[] {
    const candidates = this.list().filter((subscription) => subscription.enabled)
    return candidates.filter((subscription) => {
      if (!subscription.lastSyncAt) return true
      const next = new Date(subscription.lastSyncAt).getTime() + subscription.intervalMinutes * 60_000
      return next <= now.getTime()
    })
  }

  groups(): SubscriptionGroup[] {
    const rows = this.db.prepare('SELECT * FROM subscription_groups ORDER BY sort_order, name').all() as Array<{
      id: string
      name: string
      color: string | null
      sort_order: number
      created_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      sortOrder: row.sort_order,
      createdAt: row.created_at
    }))
  }

  createGroup(name: string, color?: string | null): SubscriptionGroup {
    const id = randomUUID()
    const max = this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM subscription_groups').get() as { m: number }
    this.db
      .prepare('INSERT INTO subscription_groups (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, color ?? null, max.m + 1, nowIso())
    this.notify('subscriptions:changed', { id })
    return this.groups().find((group) => group.id === id) as SubscriptionGroup
  }

  updateGroup(id: string, patch: { name?: string; color?: string | null; sortOrder?: number }): void {
    const sets: string[] = []
    const values: Array<string | number | null> = []
    if (patch.name !== undefined) {
      sets.push('name = ?')
      values.push(patch.name)
    }
    if (patch.color !== undefined) {
      sets.push('color = ?')
      values.push(patch.color)
    }
    if (patch.sortOrder !== undefined) {
      sets.push('sort_order = ?')
      values.push(patch.sortOrder)
    }
    if (!sets.length) return
    values.push(id)
    this.db.prepare(`UPDATE subscription_groups SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    this.notify('subscriptions:changed', { id })
  }

  deleteGroup(id: string): void {
    this.db.prepare('DELETE FROM subscription_groups WHERE id = ?').run(id)
    this.notify('subscriptions:changed', { id })
  }

  startSyncHistory(subscriptionId: string, feedId: string): string {
    const id = randomUUID()
    this.db
      .prepare(
        "INSERT INTO sync_history (id, subscription_id, feed_id, started_at, status) VALUES (?, ?, ?, ?, 'running')"
      )
      .run(id, subscriptionId, feedId, nowIso())
    return id
  }

  finishSyncHistory(
    id: string,
    result: {
      status: 'success' | 'error' | 'not_modified'
      itemsFound: number
      itemsNew: number
      itemsUpdated: number
      error?: string | null
    }
  ): void {
    this.db
      .prepare(
        'UPDATE sync_history SET finished_at = ?, status = ?, items_found = ?, items_new = ?, items_updated = ?, error = ? WHERE id = ?'
      )
      .run(nowIso(), result.status, result.itemsFound, result.itemsNew, result.itemsUpdated, result.error ?? null, id)
  }

  syncHistory(limit = 50): SyncHistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT sh.*, f.title AS feed_title FROM sync_history sh
         LEFT JOIN rss_feeds f ON f.id = sh.feed_id
         ORDER BY sh.started_at DESC LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id as string,
      subscriptionId: row.subscription_id as string,
      feedId: row.feed_id as string,
      feedTitle: (row.feed_title as string | null) ?? null,
      startedAt: row.started_at as string,
      finishedAt: (row.finished_at as string | null) ?? null,
      status: row.status as SyncHistoryEntry['status'],
      itemsFound: row.items_found as number,
      itemsNew: row.items_new as number,
      itemsUpdated: row.items_updated as number,
      error: (row.error as string | null) ?? null
    }))
  }
}
