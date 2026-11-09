import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpLeft, BookOpen, Bookmark, Box, ChevronLeft, Command, House, Menu, Moon, Search, Settings2, ShieldCheck, Sparkles, Sun, X, ArrowLeft, CircleHelp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useWorkspace } from '../hooks'
import { tools } from '../tools/index'
import { site } from '../lib/site'
import type { Route } from '../workspace'
import type { ToolId } from '../../shared/tools'
import { Modal } from './ui'
import { Brand, BrandName } from './Brand'
import { useReveal, usePointerTilt } from '../hooks/useMotion'

const pageNames: Record<Route, string> = { home: 'نظرة عامة', space: 'الفضاء ثلاثي الأبعاد', saved: 'المكتبة', settings: 'الإعدادات', guide: 'دليل البداية', ...Object.fromEntries(tools.map((tool) => [tool.id, tool.short])) as Record<ToolId, string> }

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const { navigate } = useWorkspace()
  const options: { route: Route; label: string; icon: LucideIcon; keywords: string }[] = [
    { route: 'home', label: 'نظرة عامة', icon: House, keywords: 'الرئيسية dashboard home' },
    { route: 'space', label: 'الفضاء ثلاثي الأبعاد (Three.js)', icon: Box, keywords: '3d three webgl عالم افتراضي مجسمات CeliaOS فضاء' },
    ...tools.map((tool) => ({ route: tool.id as Route, label: tool.title, icon: tool.icon, keywords: `${tool.description} ${tool.id}` })),
    { route: 'saved', label: 'النتائج المحفوظة', icon: Bookmark, keywords: 'مكتبتي saved library' },
    { route: 'settings', label: 'الإعدادات والخصوصية', icon: Settings2, keywords: 'الوضع الداكن ذكاء اصطناعي API' },
    { route: 'guide', label: 'دليل البداية والنشر', icon: BookOpen, keywords: 'مساعدة مجاني deployment help' },
  ]
  const matches = options.filter((option) => `${option.label} ${option.keywords}`.toLowerCase().includes(query.toLowerCase().trim()))
  const go = (route: Route) => { navigate(route); onClose() }
  return <Modal title="إلى أين نذهب؟" onClose={onClose} className="search-modal"><div className="search-input-wrap"><Search size={20} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن أداة أو صفحة…" aria-label="البحث في الأدوات" onKeyDown={(event) => { if (event.key === 'Enter' && matches[0]) go(matches[0].route) }} /><kbd>ESC</kbd></div><div className="search-results">{matches.length ? matches.map((option) => <button key={option.route} onClick={() => go(option.route)}><option.icon size={20} /><span>{option.label}</span><ArrowLeft size={17} /></button>) : <p className="search-empty">لا توجد صفحة بهذا الاسم. جرّب «محتوى» أو «تلخيص» أو «كود».</p>}</div><div className="search-footer"><span><Command size={13} /> K لفتح البحث</span><span>Enter لفتح أول نتيجة</span></div></Modal>
}

export function Layout({ children }: { children: ReactNode }) {
  const { route, navigate, saved, aiAvailable } = useWorkspace()
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeMobile = () => {
    setMobileOpen(false)
    // Wait until React removes inert from the main shell before restoring focus.
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus())
  }
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const sidebarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!mobileOpen || !mobile) return
    const sidebar = sidebarRef.current
    sidebar?.querySelector<HTMLButtonElement>('button')?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return
      if (event.key === 'Escape') { closeMobile(); return }
      const buttons = Array.from(sidebar?.querySelectorAll<HTMLButtonElement>('button') ?? []).filter((button) => button.offsetParent !== null)
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => document.removeEventListener('keydown', trap)
  }, [mobileOpen, mobile])
  const [searchOpen, setSearchOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen((value) => !value) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mobileOpen])
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('lek.theme', next) } catch { /* Theme still works without storage. */ }
  }
  useReveal(route)
  usePointerTilt()
  const go = (next: Route) => { navigate(next); setMobileOpen(false) }
  return <div className="app-shell">
    <a href="#main-content" className="skip-link" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>تجاوز إلى المحتوى</a>
    {mobileOpen && <button className="sidebar-backdrop" onClick={closeMobile} aria-label="إغلاق القائمة" />}
    <aside ref={sidebarRef} inert={mobile && !mobileOpen} role={mobile && mobileOpen ? 'dialog' : undefined} aria-modal={mobile && mobileOpen ? true : undefined} className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label="القائمة الرئيسية">
      <div className="sidebar-brand"><button onClick={() => go('home')} aria-label={`${site.brandLatin} — الصفحة الرئيسية`}><Brand /></button><button className="icon-button mobile-close" onClick={closeMobile} aria-label="إغلاق القائمة"><X size={20} /></button></div>
      <div className="workspace-label"><span className="workspace-avatar"><Sparkles size={17} /></span><div><strong>مساحتك الشخصية</strong><span>صغيرة بالأدوات، كبيرة بالأثر</span></div><span className="workspace-free">مجاني</span></div>
      <nav className="sidebar-nav"><span className="nav-section-label">مساحة العمل</span><button className={`nav-item ${route === 'home' ? 'active' : ''}`} onClick={() => go('home')} aria-current={route === 'home' ? 'page' : undefined}><House size={19} /><span>نظرة عامة</span>{route === 'home' && <span className="active-nav-dot" />}</button><button className={`nav-item ${route === 'space' ? 'active' : ''}`} onClick={() => go('space')} aria-current={route === 'space' ? 'page' : undefined}><Box size={19} /><span>الفضاء ثلاثي الأبعاد</span><span className="nav-3d-badge" dir="ltr">3D</span></button>
        <span className="nav-section-label tools-label">أدواتك الذكية</span>
        {tools.map((tool) => <button key={tool.id} className={`nav-item ${route === tool.id ? 'active' : ''}`} onClick={() => go(tool.id)} aria-current={route === tool.id ? 'page' : undefined}><tool.icon size={19} /><span>{tool.short}</span><span className={`tool-nav-dot ${tool.color}`} /></button>)}
        <div className="nav-divider" /><button className={`nav-item ${route === 'saved' ? 'active' : ''}`} onClick={() => go('saved')} aria-current={route === 'saved' ? 'page' : undefined}><Bookmark size={19} /><span>النتائج المحفوظة</span><span className="nav-count">{saved.length.toLocaleString('ar-EG')}</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="note-sparkle"><Sparkles size={23} strokeWidth={1.5} /></span><h3>فكرتك تستحق أن تبدأ.</h3><p>لا تحتاج إلى خبرة.<br />فقط فكرة، والباقي نكتشفه معاً.</p><button onClick={() => go('guide')}>تعرّف على <BrandName /> <ArrowUpLeft size={16} /></button><span className="note-orbit" /></div>
        <button className={`nav-item ${route === 'guide' ? 'active' : ''}`} onClick={() => go('guide')} aria-current={route === 'guide' ? 'page' : undefined}><CircleHelp size={18} /><span>دليل البداية</span><ArrowUpLeft size={14} className="nav-end-icon" /></button>
        <button className={`nav-item ${route === 'settings' ? 'active' : ''}`} onClick={() => go('settings')} aria-current={route === 'settings' ? 'page' : undefined}><Settings2 size={18} /><span>الإعدادات</span></button>
        <div className="sidebar-status"><span className="status-dot" /><span>أدواتك المحلية جاهزة دائماً</span><ShieldCheck size={14} /></div>
      </div>
    </aside>
    <div className="main-shell" inert={mobile && mobileOpen}><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="فتح القائمة" aria-expanded={mobileOpen}><Menu size={22} /></button><span className="topbar-brand"><Brand small mark={false} /></span><span className="breadcrumb-home">مساحة العمل</span><ChevronLeft size={14} /><strong>{pageNames[route]}</strong></div><div className="topbar-actions"><button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={17} /><span>ابحث عن أي شيء...</span><kbd>⌘ K</kbd></button><span className="topbar-divider" /><button className="icon-button theme-button" onClick={toggleTheme} aria-label={theme === 'light' ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'} title={theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><button className="profile-button" onClick={() => go('settings')} aria-label="إعدادات مساحتك الشخصية">ص<span /></button></div></header>
      <main id="main-content" tabIndex={-1} className="main-content">{children}</main>
      <footer className="app-footer"><span><BrandName /> — صُنع ليمنح أفكارك مساحة أكبر.</span><div><span className="footer-mode"><span className="status-dot" />{aiAvailable ? 'الوضعان المحلي والسحابي متاحان' : 'وضع محلي · خصوصية أولاً'}</span><a href={site.repoUrl} target="_blank" rel="noreferrer">المشروع مفتوح المصدر <ArrowUpLeft size={13} /></a><span dir="ltr" className="version">v0.1</span></div></footer>
    </div>
    {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
  </div>
}
