export function HeroArt() {
  return <div className="hero-art" aria-hidden="true" dir="ltr">
    <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
    <span className="art-dot dot-one" /><span className="art-dot dot-two" /><span className="art-dot dot-three" />
    <div className="art-card art-card-back"><span className="art-mini-icon"><svg viewBox="0 0 24 24" fill="none"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span><div className="art-code-lines"><i /><i /><i /><i /></div><span className="art-card-check">✓</span></div>
    <div className="art-card art-card-middle"><div className="art-document-heading"><span /><i /></div><div className="art-document-lines"><i /><i /><i /><i /></div><div className="art-highlight"><span>✦</span><i /></div><div className="art-document-lines short"><i /><i /></div></div>
    <div className="art-card art-card-front"><div className="art-front-heading"><span className="art-pencil">✎</span><span>Ideas, made yours.</span><span className="art-three-dots">•••</span></div><div className="art-front-line long" /><div className="art-front-line" /><div className="art-front-tags"><span>Create</span><span>Inspire</span><span>Grow</span></div><div className="art-front-bottom"><span>Made for your next big thing</span><span>↗</span></div></div>
    <div className="art-star star-large"><svg viewBox="0 0 100 100"><defs><linearGradient id="starGradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b6a4f4" /><stop offset=".5" stopColor="#8d73d9" /><stop offset="1" stopColor="#6b4fb4" /></linearGradient></defs><path d="M50 4C55 34 65 44 96 50C65 55 55 66 50 96C44 65 34 55 4 50C35 44 45 34 50 4Z" fill="url(#starGradient)" /><path d="M50 4C50 38 50 47 96 50C62 47 52 37 50 4Z" fill="#d4c6ff" opacity=".55" /></svg></div>
    <div className="art-star star-small">✦</div><div className="art-floating-label"><span>✦</span> أقل جهداً. أكثر إبداعاً.</div>
  </div>
}
