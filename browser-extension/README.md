# Sign-in Safety Check: a Manifest V3 learning project

A small Chrome extension that looks at the **structure** of a login page and warns about
risky setups. It was inspired by the problems identity-verification companies work on
(trust, phishing, safe sign-in). It is a personal learning project and is not affiliated
with any company.

**Privacy rule:** it never reads what a user types, never listens to keystrokes, and
never makes a network request. It checks attributes, form targets and the address only.
This is the first thing to get right in an extension that runs on login pages.

## What it checks
| Severity | Check | Why it matters |
|---|---|---|
| High | Page not served over HTTPS | Password can be read on the network |
| High | Domain uses punycode (`xn--`) | Lookalike characters can disguise a fake site |
| High | Form uses `method="get"` | Password ends up in the URL, history and logs |
| High | Form posts to an `http://` address from an https page | Password sent unencrypted |
| Warning | Form posts to a different site | Classic phishing pattern (or a legitimate SSO, so check) |
| Warning | Password field has no label | Screen readers cannot identify it (accessibility) |
| Note | `autocomplete="off"` on password | Breaks password managers. Use `current-password` / `new-password` |
| Note | Password field inside another site's frame | Sometimes legitimate, worth knowing who owns it |

The toolbar badge shows a green `OK`, or a number coloured by the worst finding. Click the icon for the list.

## Run it
1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose this folder.
   If you loaded the older "Field Spotter" version, click the reload icon on its card instead.
2. In this folder run `python3 -m http.server 8000` and open `http://localhost:8000/test-page.html`.
3. Open `safe.html` (expect green `OK`) and `risky.html` (expect red with 4 findings).
4. On `risky.html`, click the "Add a second login form" button to watch it re-scan.
5. Real pages: visit a few login pages you use. Compare how well-built ones do.

Note: `localhost` counts as a secure context, so the "not HTTPS" check will not fire there.
To see it, open the test page from your computer's LAN address (for example `http://192.168.x.x:8000/risky.html`).

## The four pieces
| File | Runs in | Job |
|---|---|---|
| `manifest.json` | n/a | Permissions (only `storage`), scripts, popup |
| `content.js` | Every page and frame | Runs the checks on the DOM, outlines flagged fields |
| `background.js` | Service worker | Stores findings per tab and frame, sets the badge |
| `popup.html/js` | Popup | Shows findings, holds the highlight toggle |

Flow: `content.js` finds issues, sends a message, `background.js` stores it in
`chrome.storage.session` and sets the badge, `popup.js` reads the same storage.

## Things to be able to explain
- **Why only the `storage` permission?** Least privilege. Fewer permissions means more trust and an easier review.
  There is no `tabs`, no host permissions, no `webRequest`.
- **Why can't the service worker keep variables?** Chrome stops it when idle. State lives in `chrome.storage.session`.
- **Why one storage key per tab and frame?** Pages can contain several frames, each running its own content script.
  A single shared key would let one frame overwrite another (a race). Separate keys avoid it.
- **Why `all_frames: true`?** Login forms are often embedded. The cross-origin-frame check runs inside each frame.
- **Why `textContent`, not `innerHTML`, in the popup?** Findings include page-derived text such as a target host.
  `textContent` cannot inject markup (XSS hygiene).
- **Why debounce the MutationObserver and skip unchanged results?** Modern pages mutate constantly.
  One scan per burst, and no message unless the findings changed, avoids message spam.
- **What is an isolated world?** The content script shares the page DOM but not its JavaScript variables.
- **MV3 vs MV2?** Background pages became service workers, remote code is banned, and request blocking moved to `declarativeNetRequest`.
- **Limits (be honest):** these are heuristics. A cross-site form is sometimes a legitimate single sign-on.
  The extension cannot tell whether a domain is trustworthy, and it does not look at what is on screen.
  Many single-page apps have no `method` attribute and intercept submit in JavaScript, which this version treats as fine.

## Exercises (one per day)
1. Detect passkey/WebAuthn support: flag fields with `autocomplete="username webauthn"` as a good sign.
2. Add an options page with an allowlist of hosts that are expected to receive logins (storage.sync).
3. Check for a visible "show password" toggle and an accessible name on it.
4. Write an automated test with Playwright that loads the unpacked extension and asserts the badge on `safe.html` and `risky.html`.
5. Port to TypeScript with Vite plus a Manifest plugin once you understand the plain version.
6. Add a Content-Security-Policy check by reading the page's `<meta http-equiv>` tag (and explain why headers are out of reach for a content script).
