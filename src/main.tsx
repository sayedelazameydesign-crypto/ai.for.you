import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import '@fontsource-variable/manrope'
import './styles.css'
import './styles/identity.css'
import App from './App'

try { document.documentElement.dataset.theme = localStorage.getItem('lek.theme') === 'dark' ? 'dark' : 'light' }
catch { document.documentElement.dataset.theme = 'light' }
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
