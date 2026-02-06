# Intent Gate Embed

This repository contains the **embed script** for Intent Gate.

The embed script is a small, dependency-free JavaScript file that companies add to their job application pages. Its role is to act as a **gatekeeper** between the application form and the Intent Gate candidate flow.

It does **not** render UI for questions, does **not** evaluate candidates, and does **not** store any personal data.

---

## What the embed script does

1. **Resolves gate** — Sends current page URL to backend; receives gateId if a gate is configured for this page
2. **Discovers form** — Auto-detects application form or uses manual selectors
3. **Issues token** — On first Submit click, issues token and opens gate UI in new tab
4. **Verifies token** — On second Submit click (after candidate completes gate), verifies token and allows or blocks form submission

---

## How it is used

Companies add a single script tag to their site (can be site-wide; script only activates on configured job pages):

```html
<script
  src="https://cdn.intent-gate.com/gate-embed.min.js"
  data-site-key="workspace-id"
  data-form-selector="#apply-form"
  data-submit-selector="button[type=submit]"
></script>
```

### Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `data-site-key` | Yes | Workspace ID — used to resolve gate by page URL |
| `data-form-selector` | No | CSS selector for application form (auto-detect if omitted) |
| `data-submit-selector` | No | CSS selector for submit button |

**Note:** No gate ID is required. The script resolves the gate automatically by sending the current page URL to the backend.

---

## Token storage and lifecycle

- **Storage:** Token is persisted in `localStorage` under key `intent_gate_token:{origin}:{gateId}` — survives page refresh
- **TTL:** 72 hours
- **Flow:** Gate opens in new tab; token is passed via postMessage handshake (IG_READY / IG_INIT)
- **Verification:** Before allowing form submit, script calls verify endpoint with tokenId, origin, pageUrl

---

## Compatible site types

| Site type | Compatibility | Notes |
|-----------|---------------|-------|
| **Static HTML** | ✅ Full | Standard forms, straightforward |
| **WordPress** | ✅ Full | Add script via theme (header/footer) or plugin |
| **SPA (React, Vue, Angular)** | ✅ Full | MutationObserver waits up to 8s for forms that mount late |
| **SSR (Next.js, Nuxt)** | ✅ Full | Form exists after hydration |
| **Shadow DOM** | ⚠️ Partial | Auto-detect may fail; use `data-form-selector` |
| **Form in iframe** | ⚠️ Partial | Script must run in same context as form |

### Requirements

- JavaScript must be enabled
- Page must have a real HTML `<form>` element
- CORS must allow the API origin
- Script must load as regular `<script>` (not ES module) for `document.currentScript`

---

## Auto form detection

When `data-form-selector` is not provided, the script auto-detects the application form using a scoring heuristic:

- **Positive signals:** file input (resume), textarea, keywords (resume, cv, cover, apply), submit button text, nearby heading
- **Negative signals:** contact/support keywords, form in footer/nav, few fields
- **Selection:** Exactly one form above threshold with sufficient score gap; otherwise does not attach

---

## Behavior guarantees

- **Fail-safe:** If no gate found, form not found, or any error — script exits silently, does not attach listeners, does not block submissions
- **No UI:** Script never adds visual elements to the page
- **Console logs:** Optional logs for debugging (form attached, not attached, resolve failed, etc.)

---

## Build and configuration

The script is built with esbuild. Configuration is injected at build time from `.env`:

```bash
cp .env.example .env
# Edit .env with your API and Gate UI URLs
npm run build
```

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `http://localhost:3000` | API server base URL |
| `GATE_UI_BASE` | `http://localhost:5173` | Gate UI base URL (gate form opens here) |
| `GATE_UI_ORIGIN` | `http://localhost:5173` | Gate UI origin (for postMessage validation) |
| `HANDSHAKE_TIMEOUT_MS` | `5000` | postMessage handshake timeout |
| `MUTATION_OBSERVER_TIMEOUT_MS` | `8000` | Max wait for form discovery (SPA) |
| `DEBOUNCE_MS` | `250` | Debounce for MutationObserver |
| `SCORE_THRESHOLD` | `5` | Min form score for auto-detection |
| `SCORE_GAP_REQUIRED` | `2` | Min score gap between top forms |
| `DEBUG` | `false` | Enable form scoring logs |

---

## Technical constraints

- No frameworks (no React, no Vue)
- No runtime dependencies
- Must work in third-party DOMs
- Must fail gracefully if misconfigured
- Must be stable and backward-compatible

---

## Privacy & security

- No candidate PII is collected or stored
- No answers or behavioral data are persisted client-side
- Tokens are opaque and validated server-side
- Origin and page URL are validated on every token issue/verify
