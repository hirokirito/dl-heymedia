import { useEffect, useState } from 'react'

// Router tối giản cho 3 loại đường dẫn dưới /tools: trang chủ, /admin, /<tool-id>.
// Không dùng react-router để chunk chung nhỏ nhất có thể.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') // "/tools"

export type Route =
  | { name: 'home' }
  | { name: 'admin' }
  | { name: 'tool'; id: string }
  | { name: 'notFound' }

export function parseRoute(pathname: string): Route {
  if (!pathname.startsWith(BASE)) return { name: 'notFound' }
  const rest = pathname.slice(BASE.length).replace(/^\/+|\/+$/g, '')
  if (rest === '') return { name: 'home' }
  if (rest === 'admin') return { name: 'admin' }
  if (/^[a-z0-9-]{1,40}$/.test(rest)) return { name: 'tool', id: rest }
  return { name: 'notFound' }
}

export function href(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`
}

export function navigate(to: string): void {
  if (to === window.location.pathname) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

// Bắt click vào <a> nội bộ để chuyển trang không tải lại.
export function onLinkClick(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const target = event.currentTarget
  if (target.target && target.target !== '_self') return
  const url = new URL(target.href, window.location.href)
  if (url.origin !== window.location.origin || !url.pathname.startsWith(BASE)) return
  event.preventDefault()
  navigate(url.pathname)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  return route
}
