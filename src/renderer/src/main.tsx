import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// Tag <html> with platform so CSS can adapt (e.g. Windows title-bar padding)
if (navigator.userAgent.includes('Windows')) {
  document.documentElement.setAttribute('data-platform', 'win32')
} else if (navigator.userAgent.includes('Mac')) {
  document.documentElement.setAttribute('data-platform', 'darwin')
} else {
  document.documentElement.setAttribute('data-platform', 'linux')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
