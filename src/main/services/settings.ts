import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { AiSettings, AppSettings, SettingsPatch } from '@shared/types'
import type { SettingsRepo } from '../db/repositories/settings'

export interface SecretBox {
  available: boolean
  encrypt: (value: string) => string
  decrypt: (value: string) => string
}

export interface ProviderConfig {
  mode: 'auto' | 'openai' | 'heuristic'
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  apiKeySet: boolean
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = result[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      result[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result as T
}

export class SettingsService {
  constructor(
    private readonly repo: SettingsRepo,
    private readonly secretBox: SecretBox,
    private readonly defaults: { managedDir: string }
  ) {}

  get(): AppSettings {
    const stored = this.repo.all()
    const storedSettings = (stored['settings'] as Partial<AppSettings> | undefined) ?? {}
    const merged = deepMerge(
      { ...DEFAULT_SETTINGS, storage: { ...DEFAULT_SETTINGS.storage, managedDir: this.defaults.managedDir } } as unknown as Record<
        string,
        unknown
      >,
      storedSettings as unknown as Record<string, unknown>
    ) as unknown as AppSettings
    const modelRow = this.repo.getAiModel()
    if (modelRow) {
      merged.ai = {
        ...merged.ai,
        baseUrl: modelRow.base_url || merged.ai.baseUrl,
        model: modelRow.model || merged.ai.model,
        temperature: modelRow.temperature,
        maxTokens: modelRow.max_tokens,
        apiKeySet: Boolean(modelRow.api_key_cipher)
      }
    }
    const sanitizedAi = { ...merged.ai } as Record<string, unknown>
    delete sanitizedAi.apiKey
    merged.ai = sanitizedAi as unknown as typeof merged.ai
    if (!merged.storage.managedDir) merged.storage.managedDir = this.defaults.managedDir
    return merged
  }

  update(patch: SettingsPatch): AppSettings {
    const current = this.get()
    const next = deepMerge(
      current as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>
    ) as unknown as AppSettings

    let cipher: string | null | undefined
    if (patch.ai?.apiKey !== undefined) {
      if (patch.ai.apiKey === null || patch.ai.apiKey === '') {
        cipher = null
      } else if (this.secretBox.available) {
        cipher = this.secretBox.encrypt(patch.ai.apiKey)
      } else {
        throw new Error('OS secure credential storage is unavailable; the API key was not saved')
      }
    }

    this.repo.saveAiModel({
      providerType: next.ai.provider,
      baseUrl: next.ai.baseUrl,
      model: next.ai.model,
      temperature: next.ai.temperature,
      maxTokens: next.ai.maxTokens,
      apiKeyCipher: cipher === undefined ? (this.repo.getAiModel()?.api_key_cipher ?? null) : cipher
    })

    const toStore: AppSettings = {
      ...next,
      ai: { ...next.ai, apiKeySet: false }
    }
    const storedAi = { ...toStore.ai } as Record<string, unknown>
    delete storedAi.apiKey
    this.repo.setRaw('settings', {
      ai: storedAi,
      rss: toStore.rss,
      storage: toStore.storage,
      appearance: toStore.appearance,
      assistant: toStore.assistant
    })
    return this.get()
  }

  providerConfig(): ProviderConfig {
    const settings = this.get()
    const row = this.repo.getAiModel()
    let apiKey = ''
    if (row?.api_key_cipher && this.secretBox.available) {
      try {
        apiKey = this.secretBox.decrypt(row.api_key_cipher)
      } catch {
        apiKey = ''
      }
    }
    return {
      mode: settings.ai.provider,
      baseUrl: (row?.base_url || settings.ai.baseUrl).replace(/\/+$/, ''),
      model: row?.model || settings.ai.model,
      apiKey,
      temperature: row?.temperature ?? settings.ai.temperature,
      maxTokens: row?.max_tokens ?? settings.ai.maxTokens,
      timeoutMs: settings.ai.timeoutMs,
      apiKeySet: Boolean(apiKey)
    }
  }

  aiSettings(): AiSettings {
    const settings = this.get()
    return { ...settings.ai, apiKeySet: Boolean(this.repo.getAiModel()?.api_key_cipher) }
  }

  dbPathForBackup(db: DatabaseSync): string {
    const row = db.prepare('PRAGMA database_list').get() as { file?: string } | undefined
    return row?.file ?? ''
  }
}
