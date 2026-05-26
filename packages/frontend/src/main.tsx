import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { applyStoredTheme } from './components/ThemeToggle'
import appleTouchIconUrl from '../assets/web/apple-touch-icon.png'
import faviconIcoUrl from '../assets/web/favicon.ico'
import './styles.css'

applyStoredTheme()

function ensureLink(rel: string, href: string) {
  let link = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.rel = rel
    document.head.appendChild(link)
  }
  link.href = href
  return link
}

ensureLink('icon', faviconIcoUrl).type = 'image/x-icon'
ensureLink('apple-touch-icon', appleTouchIconUrl)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
