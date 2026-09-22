import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Sidebar from './Sidebar.jsx'
import TopBar from './TopBar.jsx'
import BackgroundFX from './BackgroundFX.jsx'

export default function PageLayout({ children }) {
  const loc = useLocation()
  const showTopBar = loc.pathname === '/home' || loc.pathname === '/result' || loc.pathname === '/history'
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <BackgroundFX />
      <button
        className="cs-mobile-trigger btn btn-ghost btn-sm"
        onClick={() => setMobileOpen(true)}
        style={{ position: 'fixed', top: 18, left: 18, zIndex: 60 }}
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>

      {mobileOpen && <div className="cs-sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <div className={`cs-sidebar ${mobileOpen ? 'open' : ''}`}>
        <Sidebar />
        {mobileOpen && (
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            style={{
              position: 'absolute',
              top: 24,
              right: 20,
              zIndex: 60,
              background: 'var(--glass-bg-soft)',
              border: '1px solid var(--border-soft)',
              color: 'var(--text-secondary)',
              width: 34,
              height: 34,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="cs-main-wrap">
        {showTopBar && (
          <div className="cs-topbar-row">
            <TopBar />
          </div>
        )}
        <main className="cs-main" style={{ padding: `${showTopBar ? 18 : 24}px clamp(18px, 3.4vw, 54px) 40px` }}>{children}</main>
      </div>
    </>
  )
}