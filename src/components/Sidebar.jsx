import { useLocation, useNavigate } from 'react-router-dom'
import { Home, ArrowLeftRight, MessageCircle, Coins, MessageSquare, LogOut, History } from 'lucide-react'
import Logo from './Logo.jsx'
import DeleteAccount from './DeleteAccount.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const NAV = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/history', label: 'Upload History', icon: History },
  { to: '/converter', label: 'Currency Converter', icon: ArrowLeftRight },
  { to: '/chatbot', label: 'Chatbot', icon: MessageCircle },
  { to: '/collection', label: 'Collection', icon: Coins },
  { to: '/contact', label: 'Contact Us', icon: MessageSquare }
]

export default function Sidebar() {
  const loc = useLocation()
  const nav = useNavigate()
  const { logout } = useAuth()

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

      {/* spacer pushes logout to the bottom now that history lives on its own page */}
      <div style={{ flex: 1, minHeight: 0 }} />

      <div className="divider" style={{ margin: '16px 0 14px' }} />

      <DeleteAccount />

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