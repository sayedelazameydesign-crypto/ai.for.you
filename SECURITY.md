# Security and privacy

## Reporting a vulnerability

Please contact the repository owner privately through GitHub. If private vulnerability reporting is enabled, use the repository's **Security → Report a vulnerability** flow. Otherwise, open a public issue asking for a private contact channel without posting exploit details, credentials, or personal data.

## Deployment boundaries

- Never commit `.env`, provider keys, or access codes. `GROQ_API_KEY` is server-only.
- `AI_ACCESS_CODE` is a lightweight shared gate, not user authentication. Use proper authentication and centralized quotas before a public or paid launch.
- Rate limits are best-effort, in-process counters, not durable distributed quotas. Serverless instances do not share them.
- The AI endpoint accepts only known tools and bounded inputs, rejects cross-site browser requests, requires explicit consent, and calls a fixed Groq URL. It is not a general-purpose proxy.
- Prompts and authorization headers are not logged by application code. Hosting providers may maintain their own request metadata logs; review their policies.
- Code is parsed but never executed. TypeScript syntax validation is not type checking or a comprehensive security audit.
- AI-provided code rewrites are discarded. Only deterministic local formatting is offered as behavior-preserving.
- Library content is stored as text and rendered through React, not injected as HTML. Downloads are plain text.
- Uploaded files are read locally. Only text explicitly submitted in cloud mode is sent to the provider.
- Do not enter secrets, confidential source code, or sensitive personal data into a cloud model without reviewing the provider's data terms.

## Supported version

This repository is an initial release. Security fixes are applied to the default branch; no long-term support guarantee is made.
