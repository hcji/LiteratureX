import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AppDatabase } from '../database'

export interface AiModelRow {
  id: string
  name: string
  provider_type: string
  base_url: string | null
  model: string | null
  temperature: number
  max_tokens: number
  api_key_cipher: string | null
  is_default: number
  created_at: string
  updated_at: string
}

function nowIso(): string {
  return new Date().toISOString()
}

export class SettingsRepo {
  constructor(private readonly database: AppDatabase) {}

  private get db(): DatabaseSync {
    return this.database.db
  }

  getRaw<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value_json FROM application_settings WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value_json) as T
    } catch {
      return null
    }
  }

  setRaw(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO application_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
      )
      .run(key, JSON.stringify(value))
  }

  all(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value_json FROM application_settings').all() as Array<{
      key: string
      value_json: string
    }>
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value_json)
      } catch {
        /* ignore invalid settings */
      }
    }
    return result
  }

  getAiModel(): AiModelRow | null {
    return (this.db.prepare('SELECT * FROM ai_model_settings WHERE is_default = 1 LIMIT 1').get() as AiModelRow | undefined) ?? null
  }

  saveAiModel(input: {
    providerType: string
    baseUrl: string
    model: string
    temperature: number
    maxTokens: number
    apiKeyCipher: string | null
  }): void {
    const existing = this.getAiModel()
    if (existing) {
      this.db
        .prepare(
          'UPDATE ai_model_settings SET provider_type = ?, base_url = ?, model = ?, temperature = ?, max_tokens = ?, api_key_cipher = ?, updated_at = ? WHERE id = ?'
        )
        .run(
          input.providerType,
          input.baseUrl,
          input.model,
          input.temperature,
          input.maxTokens,
          input.apiKeyCipher,
          nowIso(),
          existing.id
        )
    } else {
      this.db
        .prepare(
          'INSERT INTO ai_model_settings (id, name, provider_type, base_url, model, temperature, max_tokens, api_key_cipher, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
        )
        .run(
          randomUUID(),
          'default',
          input.providerType,
          input.baseUrl,
          input.model,
          input.temperature,
          input.maxTokens,
          input.apiKeyCipher,
          nowIso(),
          nowIso()
        )
    }
  }
}
