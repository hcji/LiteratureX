import type { AppSettings } from './types'

export const APP_NAME = 'LiteratureX'
export const CLASSIFIER_PROMPT_VERSION = '2026-11-09.v1'
export const ASSISTANT_PROMPT_VERSION = '2026-11-09.v1'
export const DEFAULT_PAGE_SIZE = 50

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    provider: 'auto',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    temperature: 0.1,
    maxTokens: 1600,
    timeoutMs: 60000,
    autoClassify: true,
    sendFullText: false,
    thresholds: { high: 0.78, medium: 0.52 },
    apiKeySet: false
  },
  rss: {
    autoSync: true,
    defaultIntervalMinutes: 60,
    itemsPerSync: 80,
    contactEmail: ''
  },
  storage: {
    mode: 'managed',
    managedDir: ''
  },
  appearance: {
    theme: 'system',
    language: 'zh',
    articleTextLanguage: 'system'
  },
  assistant: {
    sendFullText: false,
    defaultContextLimit: 8
  }
}

export const CATEGORY_COLORS = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#ca8a04',
  '#0891b2',
  '#16a34a',
  '#4f46e5',
  '#b91c1c'
]
