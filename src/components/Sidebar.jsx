import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Home, ArrowLeftRight, MessageCircle, Coins, MessageSquare, LogOut, History, ExternalLink } from 'lucide-react'
import Logo from './Logo.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const NAV = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/converter', label: 'Currency Converter', icon: ArrowLeftRight },
  { to: '/chatbot', label: 'Chatbot', icon: MessageCircle },
  { to: '/collection', label: 'Collection', icon: Coins },
  { to: '/contact', label: 'Contact Us', icon: MessageSquare }
]

const HISTORY_KEY = 'coinscan_history'

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) return list
    }
  } catch (e) {
    /* ignore */
  }
  return []
}

function timeAgo(iso) {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'Just now'
  const diff = Math.max(0, Date.now() - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Sidebar() {
  const loc = useLocation()
  const nav = useNavigate()
  const { logout } = useAuth()
  const [history, setHistory] = useState(loadHistory)

  useEffect(() => {
    const refresh = () => setHistory(loadHistory())
    window.addEventListener('coinscan-history', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('coinscan-history', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const openDetails = (entry) => {
    try {
      sessionStorage.setItem(
        'coinscan_lastident',
        JSON.stringify({ items: entry.items, image: entry.image || null })
      )
    } catch (e) {
      /* ignore */
    }
    nav('/result')
  }

  return (
    <aside
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: 260,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border-soft)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        padding: '26px 20px 20px',
        transition: 'background .4s ease, border-color .4s ease',
        overflow: 'hidden'
      }}
    >
      <div style={{ padding: '0 0 22px', paddingLeft: 2 }}>
        <Logo size={30} />
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
        {NAV.map((item) => {
          const Icon = item.icon
          const active = item.to && loc.pathname === item.to
          return (
            <button
              key={item.label}
              className={`nav-item ${active ? 'active' : ''}`}
              onClick={() => {
                if (item.to) nav(item.to)
              }}
            >
              <Icon size={18} />
              <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
        {history.length > 0 && (
          <>
            <div className="divider" style={{ margin: '6px 0 2px' }} />
            <div className="sidebar-history">
              <div className="sidebar-history-head">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <History size={13.5} />
                  Upload History
                </span>
                <span className="sidebar-history-count">{history.length}</span>
              </div>
              <div className="sidebar-history-list">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    className="sidebar-history-item"
                    onClick={() => openDetails(entry)}
                    title={`View details — ${entry.name}`}
                  >
                    <div className="sidebar-history-thumb">
                      {entry.image ? (
                        <img src={entry.image} alt="" />
                      ) : (
                        <Coins size={15} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="sidebar-history-name">{entry.name}</div>
                      <div className="sidebar-history-time">{timeAgo(entry.timestamp)}</div>
                    </div>
                    <span className="sidebar-history-view">
                      <ExternalLink size={12.5} />
                      View
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="divider" style={{ margin: '16px 0 14px' }} />

      <button
        className="nav-item"
        onClick={() => {
          logout()
          nav('/login', { replace: true })
        }}
        style={{ color: 'var(--text-faint)', flexShrink: 0 }}
      >
        <LogOut size={18} />
        <span style={{ whiteSpace: 'nowrap' }}>Logout</span>
      </button>

      {/* bottom tagline */}
      <div
        style={{
          marginTop: 22,
          paddingLeft: 2,
          paddingBottom: 16
        }}
      >
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 5
          }}
        >
          Discover · Identify · Explore
        </div>
        <div
          style={{
            width: 46,
            height: 1.5,
            borderRadius: 9,
            background: 'linear-gradient(90deg, var(--accent), transparent)'
          }}
        />
      </div>

      {/* background coin silhouette */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: -70,
          left: -50,
          width: 220,
          height: 220,
          borderRadius: '9999px',
          background: 'radial-gradient(circle at 38% 32%, rgba(0,229,195,0.09), rgba(0,0,0,0.3) 70%)',
          border: '1px solid rgba(0,229,195,0.06)',
          filter: 'blur(8px)',
          pointerEvents: 'none'
        }}
      />
    </aside>
  )
}