# Permission notes (for store reviewers)

Reusable justification text for every submission. Copy the relevant section into the store form
instead of rewriting it each release.

## Required permissions

| Permission | Why |
|---|---|
| `storage` | Store provider settings and captured snapshots in the browser only |
| `tabs` | Find the tab that already shows a registered usage page, and open one when the user refreshes |
| `scripting` | Inject the local reader into a registered usage page the user granted access to |
| Host access to `https://raw.githubusercontent.com/ishizakahiroshi/*` | Fetch the URL-only sample registry, and only after the user confirms **Try samples** |

## Optional permissions

| Permission | Why | When it is requested |
|---|---|---|
| Host access (`*://*/*`) | Read the usage page the user registered | When the user adds or saves a provider |
| `contextualIdentities` (Firefox only) | List the user's containers so an account entry can be pinned to one | Only when the user turns on containers in Settings |
| `cookies` (Firefox only) | Required by Firefox to pass a `cookieStoreId` to `tabs.create`, i.e. to open the usage page inside the chosen container | Same as above |

### Notes on `contextualIdentities` / `cookies`

A browser profile keeps one session per site, so a user with two accounts on the same AI service
can only ever see one of them. Firefox containers are the only mechanism that lets both sessions
exist at once, so the extension opens each account's usage page in the container the user assigned
to it.

- Cookie values are never read, written, or transmitted. The `cookies` permission is needed purely
  because Firefox gates the `cookieStoreId` argument of `tabs.create` behind it.
- Both permissions are optional and requested only when the user explicitly enables containers.
  Declining leaves the extension fully functional; accounts are then refreshed one at a time by
  switching accounts in the browser.
- Chrome builds never declare these permissions — Chrome has no container API.

## Multi-account identity data

To decide which entry a capture belongs to, the user can teach where the account identity (an email
address or display name) sits on the page. The extension stores the element's selector/fingerprint
and a SHA-256 hash of the text, salted with a per-install random value. The identity text itself is
never stored, never logged, and never leaves the browser.
