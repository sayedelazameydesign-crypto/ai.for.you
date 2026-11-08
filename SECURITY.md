# Security and privacy

## Reporting a vulnerability

Please contact the repository owner privately through GitHub. If private vulnerability reporting is enabled, use the repository's **Security → Report a vulnerability** flow. Otherwise, open a public issue asking for a private contact channel without posting exploit details, credentials, or personal data.

## Deployment boundaries

- Never commit `.env`, provider keys, or access codes. `GROQ_API_KEY` is server-only.
- `AI_ACCESS_CODE` is a lightweight shared gate, not user authentication. Use proper authentication and centralized quotas before a public or paid launch.
- Rate limits are best-effort, in-process counters, not durable distributed quotas. Serverless instances do not share them.
- Client identity for the rate limiter comes from declared configuration (`AI_TRUSTED_PROXY`), never from a header the request can choose. Unset means a single shared bucket: coarse, but not spoofable. When a proxy is declared, the **last** hop of the forwarding header is used, since earlier hops may be attacker-supplied. Addresses are hashed before they are used as keys, so counter memory holds no raw address.
- Prompt injection is a known, accepted risk of any language model. Tool input is passed as data and the system prompt instructs the model to treat it as data, and no result is trusted: every response is validated against a strict schema, and AI-provided code rewrites are discarded. This is mitigation, not immunity.
- A Content Security Policy is sent as a header on platforms that allow headers and as a meta tag on static hosts. The production policy forbids `unsafe-eval` and inline script; the relaxed policy exists only for the local dev server, which needs both.
- The AI endpoint accepts only registered tools and bounded inputs, requires explicit consent, and calls a fixed provider URL. It is not a general-purpose proxy.
- Cross-origin calls are rejected unless the origin appears in `AI_ALLOWED_ORIGINS`. CORS is a browser mechanism, not a security boundary: `curl` ignores it. The access code, per-client rate limit and token cap are what protect the quota.
- Provider completion budgets, timeouts and daily ceilings are clamped server-side; out-of-range environment values fall back to safe defaults.
- A repository guard (`scripts/guard-secrets.mjs`) rejects provider-key literals, secrets assigned to browser-exported prefixes, and private-key blocks. It complements, and does not replace, GitHub secret scanning and push protection.
- Prompts and authorization headers are not logged by application code. Hosting providers may maintain their own request metadata logs; review their policies.
- Code is parsed but never executed. TypeScript syntax validation is not type checking or a comprehensive security audit.
- AI-provided code rewrites are discarded. Only deterministic local formatting is offered as behavior-preserving.
- Library content is stored as text and rendered through React, not injected as HTML. Downloads are plain text.
- Uploaded files are read locally. Only text explicitly submitted in cloud mode is sent to the provider.
- Do not enter secrets, confidential source code, or sensitive personal data into a cloud model without reviewing the provider's data terms.

## Supported version

This repository is an initial release. Security fixes are applied to the default branch; no long-term support guarantee is made.
