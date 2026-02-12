# Embed Developer Specification (MVP)

## Purpose

This document defines how the Intent Gate embed script must be implemented. It is the authoritative specification for behavior, integration, security, and edge cases.

The embed script is **not a UI product**. It is a small integration layer that enforces gate completion before a form submission.

---

## Responsibilities

The embed script must:
- Run safely on third-party websites
- Issue candidate tokens via the API
- Redirect candidates to the Intent Gate UI
- Verify gate completion before allowing form submission
- Never break or hijack the host page

The embed script must **not**:
- Render the candidate questions
- Evaluate answers
- Store candidate personal data
- Control analytics logic beyond required events

---

## Integration via script tag

All configuration is passed via HTML `data-*` attributes.

Required attributes:
- data-gate-id
- data-form-selector
- data-submit-selector

Optional attributes:
- data-return-url — return URL after gate completion (default: current page URL)

---

## Lifecycle

### Page load and URL changes (SPA)
- On first load: set up URL change listener (History API: pushState, replaceState, popstate).
- On each URL change (including initial load), run the flow for the **current** URL:
  - Resolve gate by page URL (POST /v1/gates/resolve).
  - If no gate for this page → do nothing.
  - Wait for form (selector or auto-detect); if no form found → do nothing.
  - Only then attach submit handler. If URL changes before attach completes, abort and do not attach.
- Thus on SPA, navigating from e.g. homepage to job page triggers a new run; the script attaches only on the job page when gate and form are present.

### Page load (single run)
- Read and validate attributes
- Locate form and submit button
- Call POST /v1/token/issue
- Store token in sessionStorage

If any step fails:
- Log warning to console
- Disable script silently

### Apply click
- Prevent default submit
- Redirect to gate with token and return_url

### Return from gate
- Intercept submit
- Call POST /v1/token/verify
- Allow or block submission

---

## Storage rules

- sessionStorage only
- No cookies
- No persistent storage

---

## UX constraints

- Short, neutral messages
- No technical errors exposed
- No aggressive alerts

---

## Build requirements

- Single minified file
- < 15KB gzipped
- ES2018 compatible
- No source maps

---

## Definition of done

- Works on arbitrary forms
- Handles misconfiguration gracefully
- No regressions
