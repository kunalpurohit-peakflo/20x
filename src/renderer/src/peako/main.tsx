import React from 'react'
import ReactDOM from 'react-dom/client'
import { PeakoApp } from './PeakoApp'
import '../styles/globals.css'
import './peako.css'

// Follow the app's light or dark choice when it changes in the main window.
window.addEventListener('storage', (event) => {
  if (event.key !== 'ui-theme') return
  const mode = event.newValue || 'dark'
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PeakoApp />
  </React.StrictMode>
)
