/**
 * LOC-001: lightweight i18n foundation.
 *
 * No third-party runtime. Default locale is en-US. Call `t('key')` for
 * catalog lookups; missing keys fall back to the key string in __DEV__
 * and log once so drift is visible without crashing money flows.
 *
 * Adding a locale later:
 *   1. Add `locales/<tag>.ts` implementing MessageCatalog
 *   2. Register it in LOCALES
 *   3. Call setLocale('<tag>') from settings when the user picks it
 */

import { enUS, type MessageCatalog, type MessageId } from './locales/en-US';

export type { MessageId, MessageCatalog };
export { enUS };

const LOCALES: Record<string, MessageCatalog> = {
  'en-US': enUS,
};

let activeLocale = 'en-US';
const missingKeys = new Set<string>();

export function getLocale(): string {
  return activeLocale;
}

export function listLocales(): string[] {
  return Object.keys(LOCALES);
}

/**
 * Switch active locale. Unknown tags fall back to en-US and return false.
 */
export function setLocale(tag: string): boolean {
  if (!LOCALES[tag]) {
    if (__DEV__) {
      console.warn(`[i18n] unknown locale "${tag}", keeping ${activeLocale}`);
    }
    return false;
  }
  activeLocale = tag;
  return true;
}

/**
 * Resolve a message id for the active locale.
 * Optional `vars` replaces `{name}` placeholders in the string.
 */
export function t(id: MessageId, vars?: Record<string, string | number>): string {
  const catalog = LOCALES[activeLocale] ?? enUS;
  let value: string = catalog[id] ?? enUS[id] ?? String(id);

  if (value === String(id) && !missingKeys.has(String(id))) {
    missingKeys.add(String(id));
    if (__DEV__) {
      console.warn(`[i18n] missing message: ${id}`);
    }
  }

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return value;
}

/** Test helper — reset to default locale and clear missing-key cache. */
export function __resetI18nForTests(): void {
  activeLocale = 'en-US';
  missingKeys.clear();
}
