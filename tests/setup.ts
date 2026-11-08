import '@testing-library/dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

document.documentElement.lang = 'ar'
document.documentElement.dir = 'rtl'
afterEach(() => { cleanup(); localStorage.clear() })
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function (this: HTMLDialogElement) { this.setAttribute('open', '') }, writable: true })
Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function (this: HTMLDialogElement) { this.removeAttribute('open') }, writable: true })
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
})
