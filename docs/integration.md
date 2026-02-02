# Embed Integration Guide

## Overview

The Intent Gate embed script requires candidates to complete a short Intent Gate step before submitting a job application form.

---

## Integration steps

1. Identify the application form selector
2. Insert the embed script before </body>
3. Replace attributes with your values

Example:

```html
<script
  src="https://cdn.intent-gate.com/gate-embed.min.js"
  data-gate-id="gate_123"
  data-form-selector="#apply-form"
  data-submit-selector="button[type=submit]"
></script>
```

The script automatically uses the current page URL as the return destination. Optionally, you can override with `data-return-url` for a custom return URL.

---

## Common issues

- Incorrect form selector
- Incorrect submit button selector
- Multiple forms on page

---
