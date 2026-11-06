import type { ReactNode } from 'react'
import { href, onLinkClick } from '../lib/router'
import { Icon } from './Icon'

export function Header({ active }: { active: 'tools' | 'admin' }) {
  return (
    <header className="topbar">
      <a className="brand" href={href('')} onClick={onLinkClick}>
        <span className="mark" aria-hidden="true">⚒</span>
        <span className="brand-text">
          <span className="brand-title">Hey Tools</span>
          <span className="brand-sub">Hey Media · nội bộ</span>
        </span>
      </a>
      <nav className="nav" aria-label="Chuyển trang">
        <a href="/">Downloader</a>
        <a href={href('')} onClick={onLinkClick} aria-current={active === 'tools' ? 'page' : undefined}>Hey Tools</a>
      </nav>
      <a className={`nav-admin${active === 'admin' ? ' is-active' : ''}`} href={href('admin')} onClick={onLinkClick} aria-current={active === 'admin' ? 'page' : undefined}>
        <Icon name="sliders" size={16} />
        Quản trị
      </a>
    </header>
  )
}

export function PrivacyNote() {
  return (
    <p className="privacy">
      <Icon name="shield" size={16} />
      File được xử lý trên máy bạn, không tải lên server.
    </p>
  )
}

export function Page({ active = 'tools', children }: { active?: 'tools' | 'admin'; children: ReactNode }) {
  return (
    <div className="shell">
      <Header active={active} />
      <main className="main" id="main">{children}</main>
    </div>
  )
}

export function BackLink() {
  return (
    <a className="back" href={href('')} onClick={onLinkClick}>
      <Icon name="back" size={16} />
      Tất cả tool
    </a>
  )
}
