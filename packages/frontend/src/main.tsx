import { QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { applyStoredTheme } from './components/ThemeToggle'
import { queryClient } from './query'
import appleTouchIconUrl from '../assets/web/apple-touch-icon.png'
import faviconIcoUrl from '../assets/web/favicon.ico'
import './styles.css'

applyStoredTheme()

function ensureLink(rel: string, href: string) {
  let link = document.head.querySelector(`link[rel="${rel}"]`)
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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
