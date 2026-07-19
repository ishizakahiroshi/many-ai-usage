import { afterEach, describe, expect, it } from 'vitest';
import catalog from '../src/locales/catalog.json';
import en from '../src/locales/en.json';
import ja from '../src/locales/ja.json';
import {
  clearI18nCache,
  createTranslator,
  initI18n,
  listLocales,
  resolveLocale,
  type LocaleCatalog,
  type MessageTable,
} from '../src/shared/i18n';

const catalogTyped = catalog as LocaleCatalog;
const enTyped = en as MessageTable;
const jaTyped = ja as MessageTable;

afterEach(() => clearI18nCache());

describe('resolveLocale', () => {
  it('matches exact, language subtag, then default', () => {
    expect(resolveLocale('ja', catalogTyped)).toBe('ja');
    expect(resolveLocale('ja-JP', catalogTyped)).toBe('ja');
    expect(resolveLocale('en-US', catalogTyped)).toBe('en');
    expect(resolveLocale('fr-FR', catalogTyped)).toBe('en');
    expect(resolveLocale(undefined, catalogTyped)).toBe('en');
  });
});

describe('createTranslator', () => {
  it('interpolates vars and falls back to default pack / key', () => {
    const t = createTranslator(jaTyped, enTyped);
    expect(t('report.link')).toBe('不具合を報告');
    expect(t('reportBody.extension', { version: '0.1.0' })).toContain('v0.1.0');
    expect(t('missing.key')).toBe('missing.key');
  });
});

describe('initI18n with packs', () => {
  it('loads Japanese when preferred is ja', async () => {
    const i18n = await initI18n({
      preferred: 'ja-JP',
      useStoredPreference: false,
      packs: { en: enTyped, ja: jaTyped },
      catalog: catalogTyped,
    });
    expect(i18n.locale).toBe('ja');
    expect(i18n.t('report.dialogTitle')).toBe('不具合を報告');
    expect(i18n.t('common.close')).toBe('閉じる');
  });

  it('loads English by default', async () => {
    const i18n = await initI18n({
      preferred: 'de',
      useStoredPreference: false,
      packs: { en: enTyped, ja: jaTyped },
      catalog: catalogTyped,
    });
    expect(i18n.locale).toBe('en');
    expect(i18n.t('report.dialogTitle')).toBe('Report a problem');
  });

  it('lists catalog locales for the header language picker', () => {
    const list = listLocales(catalogTyped);
    expect(list.map((item) => item.code).sort()).toEqual(['en', 'ja']);
    expect(list.find((item) => item.code === 'ja')?.label).toBe('日本語');
  });
});

describe('locale pack parity', () => {
  it('keeps the same keys in en and ja packs', () => {
    const enKeys = Object.keys(enTyped).sort();
    const jaKeys = Object.keys(jaTyped).sort();
    expect(jaKeys).toEqual(enKeys);
  });

  it('catalog files exist for every registered locale', () => {
    for (const [code, meta] of Object.entries(catalogTyped.locales)) {
      expect(meta.file).toBeTruthy();
      if (code === 'en') expect(Object.keys(enTyped).length).toBeGreaterThan(0);
      if (code === 'ja') expect(Object.keys(jaTyped).length).toBeGreaterThan(0);
    }
  });
});
