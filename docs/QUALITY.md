# Quality and release checklist

## Automated checks

```bash
npm ci
npm run check
npm audit --audit-level=high
npx playwright install chromium
npm run test:browser
node scripts/guard-secrets.mjs
npm run check:build
npm run check:sql
npm run check:evidence -- --full
npm run test:smoke -- <published-url> [api-base]
```

In a minimal Linux container, an existing Chromium executable can be supplied with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Its system libraries must also be installed. The browser suite starts Vite automatically, or reuses a local server on port 5173.

Coverage includes:

- Local marketing variants, language/tone, X length limits, input validation.
- Extractive summaries grounded in original sentences, length controls and limits.
- JavaScript/JSX/TypeScript syntax, JSON, source locations, safe formatting.
- Explicit saving, persistence, search, deletion, file validation and downloads.
- Server-only secrets, access code, consent, origin checks, bounded bodies, provider error mapping, per-client and daily ceilings.
- Real Chromium desktop/mobile workflows, theme persistence, deep links, keyboard focus and no horizontal overflow (12 tests in 2 files, listed by `npx playwright test --list`; the count is asserted in `docs/EVIDENCE.md`, so a change here fails the build if the doc is not updated).
- axe-core WCAG A/AA automated checks on all seven core pages in light and dark themes.
- Hosting identity resolved from the environment: repository rename, custom domain, rejected non-http schemes, CNAME and base normalization.
- Both tool registries stay in sync with the shared id list.
- Versioned `/api/v1` routing, explicit origin allowlist, preflight handling, one bounded provider retry, and token-budget clamping.
- A post-deploy smoke test that requests the published page and the status endpoint.
- A motion suite run with animation enabled, covering scroll reveal, pointer tilt, reduced-motion fallbacks, brand presence, and mobile hero overlap.
- A build-output assertion: complete `dist`, no unreplaced identity placeholders, within the Pages size limit, and no provider key in any published asset.

Automated accessibility checks do not replace manual assistive-technology testing. Syntax checking does not replace TypeScript type checking, unit tests in user code, or security review.

## Before a public launch

- Merge reviewed changes into `main`, enable GitHub Pages Actions publishing, and confirm the actual deployment URL. The `verify` job must pass.
- After a repository rename or domain change, confirm the new URL, update `AI_ALLOWED_ORIGINS` on any separate proxy, and relink Vercel/Cloudflare projects.
- For cloud mode, configure server secrets and verify a live Groq request using a non-sensitive prompt. Mocked tests are not live-provider verification.
- Confirm current provider quotas, country availability, data terms, and hosting commercial-use terms.
- Replace the shared access gate with authentication and centralized durable quotas before offering a public paid service.
- Review privacy, retention, abuse handling, payment availability and tax obligations.
- Test with screen readers and real mobile devices in addition to the automated suite.

## Reporting results

Record the exact command and result. Do not describe a deployment, live AI response, payment integration, or revenue as working until it has been verified. Keep screenshots, traces, builds and dependencies out of Git.
