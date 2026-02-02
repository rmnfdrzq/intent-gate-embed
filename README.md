# Intent Gate Embed

This repository contains the **embed script** for Intent Gate.

The embed script is a small, dependency-free JavaScript file that companies add to their job application pages. Its role is to act as a **gatekeeper** between the application form and the Intent Gate candidate flow.

It does **not** render UI for questions, does **not** evaluate candidates, and does **not** store any personal data.

---

## What the embed script does

1. Issues a token for a candidate session
2. Redirects the candidate to the Intent Gate flow
3. Verifies that the gate was passed
4. Allows or blocks form submission accordingly

---

## How it is used

Companies add a single script tag to their application page:

```html
<script
  src="https://cdn.intent-gate.com/gate-embed.min.js"
  data-gate-id="gate_123"
  data-form-selector="#apply-form"
  data-submit-selector="button[type=submit]"
></script>
```

The script automatically returns users to the current page after completing the gate.

No additional JavaScript integration is required.

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

---
