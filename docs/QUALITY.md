# Quality and release checklist

## Automated checks

```bash
npm ci
npm run check
npm audit --audit-level=high
npx playwright install chromium
npm run test:browser
```

In a minimal Linux container, an existing Chromium executable can be supplied with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Its system libraries must also be installed. The browser suite starts Vite automatically, or reuses a local server on port 5173.

Coverage includes:

- Local marketing variants, language/tone, X length limits, input validation.
- Extractive summaries grounded in original sentences, length controls and limits.
- JavaScript/JSX/TypeScript syntax, JSON, source locations, safe formatting.
- Explicit saving, persistence, search, deletion, file validation and downloads.
- Server-only secrets, access code, consent, origin checks, bounded bodies, provider error mapping, per-client and daily ceilings.
- Real Chromium desktop/mobile workflows, theme persistence, deep links, keyboard focus and no horizontal overflow.
- axe-core WCAG A/AA automated checks on all seven core pages in light and dark themes.

Automated accessibility checks do not replace manual assistive-technology testing. Syntax checking does not replace TypeScript type checking, unit tests in user code, or security review.

## Before a public launch

- Merge reviewed changes into `main`, enable GitHub Pages Actions publishing, and confirm the actual deployment URL.
- For cloud mode, configure server secrets and verify a live Groq request using a non-sensitive prompt. Mocked tests are not live-provider verification.
- Confirm current provider quotas, country availability, data terms, and hosting commercial-use terms.
- Replace the shared access gate with authentication and centralized durable quotas before offering a public paid service.
- Review privacy, retention, abuse handling, payment availability and tax obligations.
- Test with screen readers and real mobile devices in addition to the automated suite.

## Reporting results

Record the exact command and result. Do not describe a deployment, live AI response, payment integration, or revenue as working until it has been verified. Keep screenshots, traces, builds and dependencies out of Git.
