# Embed Integration Guide

## Overview

The Intent Gate embed script requires candidates to complete a short Intent Gate step before submitting a job application form. The gate opens in a **new tab**; the application form stays on the page. The candidate completes the gate, returns to the form, and clicks Submit again.

---

## Prerequisites

1. **Gate configured** — Create a gate in the dashboard with:
   - **jobPageUrl** — Full URL of the vacancy page (e.g. `https://yoursite.com/jobs/senior-developer`)
   - Optional: form selector and submit selector overrides

2. **Workspace ID (siteKey)** — Used in the script snippet; the embed resolves the gate by page URL within this workspace

---

## Integration steps

1. **Set jobPageUrl** in gate settings (the exact vacancy page where the application form lives)

2. **Add the script** to your site (can be site-wide; script only activates on configured job pages):

```html
<script
  src="https://embed.applyintent.com/loader.js"
  data-site-key="your-workspace-id"
></script>
```

3. **Optional overrides** — If auto-detection does not find the form:

```html
<script
  src="https://embed.applyintent.com/loader.js"
  data-site-key="your-workspace-id"
  data-form-selector="#applyForm"
  data-submit-selector="#submitButton"
></script>
```

---

## Candidate flow

1. Candidate loads the site (any page) or navigates within an SPA.
2. **On each URL change** (including first load), the script:
   - Resolves the gate by current page URL (if no gate for this page → script does nothing).
   - Looks for an application form (auto-detect or manual selector).
   - **Only if** the page is a configured job page **and** a form is found, the script attaches; otherwise it does nothing for that page.
3. On the job page, when the candidate clicks Submit:
   - **First Submit click:** Script issues token, opens gate in new tab, candidate completes gate.
   - Candidate returns to form, clicks Submit again.
   - **Second Submit click:** Script verifies token; if PASSED → form submits; otherwise → gate re-opens.

On **SPA sites**, the script does not run only on the first page load: it listens for URL changes (History API: pushState, replaceState, popstate). When the user navigates (e.g. from homepage to a job page), the script re-runs for the new URL and attaches to the form only on the job page where a gate is configured and a form is present.

---

## Compatible site types

| Site type | Compatibility | Notes |
|-----------|---------------|-------|
| **Static HTML** | ✅ Full | Standard forms |
| **WordPress** | ✅ Full | Add via theme or plugin |
| **SPA (React, Vue, Angular)** | ✅ Full | Script re-runs on every URL change; attaches only on job pages with a form. MutationObserver waits up to 8s for late-mounted forms |
| **SSR (Next.js, Nuxt)** | ✅ Full | Form exists after hydration |
| **Shadow DOM** | ⚠️ Partial | Use `data-form-selector` if auto-detect fails |
| **Form in iframe** | ⚠️ Partial | Script must run in same context as form |

---

## Token storage

- Token is stored in `localStorage` under `intent_gate_token:{origin}:{gateId}`
- Survives page refresh
- TTL: 72 hours
- Gate opens in new tab; token passed via postMessage (IG_READY / IG_INIT)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Embed does not activate | Ensure `data-site-key` is workspace ID; gate must have jobPageUrl for current page. On SPA, ensure navigation uses History API (pushState/replaceState) or back/forward so URL changes are detected |
| Form not detected | Add `data-form-selector` and `data-submit-selector` |
| Multiple forms on page | Use `data-form-selector` to target the application form |
| Form mounts late (SPA) | Script waits up to 8 seconds; if longer, use `data-form-selector` |

---

## Common issues

- Incorrect form selector
- Incorrect submit button selector
- Multiple forms on page (ambiguous)
- jobPageUrl mismatch (query/hash stripped; path must match exactly)
