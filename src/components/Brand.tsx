import { site } from '../lib/site'

/**
 * The celia.sh logomark: an open ring reading as a lowercase "c", with a spark
 * sitting in the gap. Decorative only — the wordmark carries the accessible name.
 */
export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true">
    <svg viewBox="0 0 32 32" fill="none" focusable="false">
      <path d="M21.4 21.6a8.2 8.2 0 1 1 .2-11.4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M24.6 6.5l1.25 3.4 3.4 1.25-3.4 1.25-1.25 3.4-1.25-3.4-3.4-1.25 3.4-1.25z" fill="currentColor" />
    </svg>
    <span className="brand-mark-sheen" />
  </span>
}

/** Splits `celia.sh` so the TLD can carry the accent colour. Env-driven, never hardcoded. */
export function Wordmark({ className = '' }: { className?: string }) {
  const name = site.brandLatin
  const dot = name.lastIndexOf('.')
  const head = dot > 0 ? name.slice(0, dot) : name
  const tld = dot > 0 ? name.slice(dot) : ''
  return <span className={`wordmark ${className}`} dir="ltr">
    {head}{tld && <span className="wordmark-tld">{tld}</span>}
  </span>
}

/**
 * Latin-primary lockup. `small` drops the Arabic line for tight spaces such as
 * the mobile top bar, where the sidebar — and with it the brand — is hidden.
 */
export function Brand({ small = false, mark = true }: { small?: boolean; mark?: boolean }) {
  return <span className={`brand ${small ? 'brand-small' : ''}`}>
    {mark && <BrandMark />}
    <span className="brand-text">
      <Wordmark />
      {!small && <span className="brand-arabic">{site.brandAr} · أدوات ذكية</span>}
    </span>
  </span>
}

/**
 * Inline mention inside Arabic prose. `dir="ltr"` keeps the dot in place, and
 * `unicode-bidi: isolate` stops the run from pulling adjacent Arabic punctuation
 * (such as a trailing question mark) to the wrong side of the name.
 */
export function BrandName() {
  return <b className="brand-inline" dir="ltr">{site.brandLatin}</b>
}
