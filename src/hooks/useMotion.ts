import { useEffect } from 'react'

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Reveals `[data-reveal]` blocks as they scroll into view.
 *
 * Elements are only hidden once JavaScript has armed them, so a scripting
 * failure, a missing IntersectionObserver, or reduced motion all leave the
 * content fully visible rather than stuck at opacity zero.
 */
export function useReveal(route: string) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!nodes.length) return
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      nodes.forEach((node) => node.classList.add('is-revealed'))
      return
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-revealed')
        observer.unobserve(entry.target)
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 })

    for (const node of nodes) {
      // Already on screen at mount: show immediately so the first paint is never blank.
      const box = node.getBoundingClientRect()
      if (box.top < window.innerHeight && box.bottom > 0) node.classList.add('is-revealed')
      else { node.classList.add('reveal-armed'); observer.observe(node) }
    }
    return () => observer.disconnect()
  }, [route])
}

/**
 * Pointer-driven tilt and cursor glow for `[data-tilt]` cards.
 *
 * Deliberately skipped for coarse pointers and reduced motion: on touch there is
 * no hover to follow, and the effect would only cost battery. Listeners are
 * delegated so cards added by a later render work without re-binding.
 */
export function usePointerTilt() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    if (prefersReducedMotion()) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let frame = 0
    let active: HTMLElement | null = null

    const reset = (node: HTMLElement | null) => {
      if (!node) return
      node.style.removeProperty('--tilt-x')
      node.style.removeProperty('--tilt-y')
      node.style.removeProperty('--glow-x')
      node.style.removeProperty('--glow-y')
    }

    const onMove = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tilt]') ?? null
      if (target !== active) { reset(active); active = target }
      if (!active) return
      const node = active
      const { clientX, clientY } = event
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        const box = node.getBoundingClientRect()
        if (!box.width || !box.height) return
        const px = (clientX - box.left) / box.width
        const py = (clientY - box.top) / box.height
        // Clamped: a pointer near the edge must not produce an extreme angle.
        const clamp = (value: number) => Math.min(1, Math.max(0, value))
        node.style.setProperty('--tilt-x', `${((0.5 - clamp(py)) * 5).toFixed(2)}deg`)
        node.style.setProperty('--tilt-y', `${((clamp(px) - 0.5) * 5).toFixed(2)}deg`)
        node.style.setProperty('--glow-x', `${(clamp(px) * 100).toFixed(1)}%`)
        node.style.setProperty('--glow-y', `${(clamp(py) * 100).toFixed(1)}%`)
      })
    }

    const onLeave = () => { if (frame) cancelAnimationFrame(frame); frame = 0; reset(active); active = null }

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
      onLeave()
    }
  }, [])
}
