import { describe, expect, it } from 'vitest';
import {
  accountKeyHashPattern,
  accountSaltPattern,
  createAccountSalt,
  hashAccountKey,
  normalizeAccountText,
} from '../src/shared/account';
import { createAccountAnchor, readAccountAnchorText } from '../src/content/teach/accountAnchor';
import { accountAnchorSelectorPattern, safeParseAccountAnchor } from '../src/shared/schema';

// Synthetic identities only — never paste a real account address into a fixture.
const SALT_A = 'a'.repeat(64);
const SALT_B = 'b'.repeat(64);

describe('account identity hashing', () => {
  it('folds spacing and case so an SPA re-render still matches', () => {
    expect(normalizeAccountText('  Person\n  A@Example.com ')).toBe('person a@example.com');
  });

  it('is stable for the same identity and salt', async () => {
    const first = await hashAccountKey('person-a@example.com', SALT_A);
    const second = await hashAccountKey('  PERSON-A@example.com  ', SALT_A);
    expect(first).toBe(second);
    expect(first).toMatch(accountKeyHashPattern);
  });

  it('differs per install so a stored hash cannot be compared across browsers', async () => {
    const withA = await hashAccountKey('person-a@example.com', SALT_A);
    const withB = await hashAccountKey('person-a@example.com', SALT_B);
    expect(withA).not.toBe(withB);
  });

  it('separates two accounts of the same service', async () => {
    const salt = createAccountSalt();
    expect(salt).toMatch(accountSaltPattern);
    const first = await hashAccountKey('person-a@example.com', salt);
    const second = await hashAccountKey('person-b@example.com', salt);
    expect(first).not.toBe(second);
  });

  it('returns null when the element carries no identity', async () => {
    expect(await hashAccountKey('   ', SALT_A)).toBeNull();
    expect(await hashAccountKey('', SALT_A)).toBeNull();
  });
});

describe('text-free account anchors', () => {
  it('stores only a numeric DOM path even when every page attribute contains identity text', () => {
    document.body.innerHTML = `
      <main id="person-a@example.com" class="person-a@example.com">
        <span aria-label="person-a@example.com">person-a@example.com</span>
      </main>`;
    const element = document.querySelector('span')!;
    const anchor = createAccountAnchor(element);
    const serialized = JSON.stringify(anchor);

    expect(anchor.selector).toMatch(accountAnchorSelectorPattern);
    expect(serialized).not.toContain('person-a');
    expect(serialized).not.toContain('example.com');
    expect(readAccountAnchorText(document, anchor)).toBe('person-a@example.com');
  });

  it('rejects extra fingerprint fields at the background trust boundary', () => {
    const anchor = { selector: ':root > :nth-child(2) > :nth-child(1)' };
    expect(safeParseAccountAnchor(anchor)).toEqual(anchor);
    expect(safeParseAccountAnchor({ ...anchor, nearbyLabel: 'person-a@example.com' })).toBeNull();
    expect(safeParseAccountAnchor({ selector: 'span[aria-label="person-a@example.com"]' })).toBeNull();
  });
});
