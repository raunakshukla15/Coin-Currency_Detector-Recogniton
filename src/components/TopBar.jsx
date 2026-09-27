import { useState } from 'react'
import { HelpCircle, Sun, Moon } from 'lucide-react'
import Modal from './Modal.jsx'
import Logo from './Logo.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'

export default function TopBar() {
  const [aboutOpen, setAboutOpen] = useState(false)
  const { user } = useAuth()
  const { theme, toggleTheme } = useTheme()

  return (
    <>
      <div className="hrow">
        <button className="hbtn" onClick={() => setAboutOpen(true)} title="About CoinScan">
          <HelpCircle size={14} />
          About
        </button>

        <button className="hbtn hbtn-theme" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
          <span className={`theme-knob${theme === 'dark' ? ' dark' : ''}`} />
          <span
            className="theme-half"
            style={{ color: theme === 'light' ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            <Sun size={14} />
          </span>
          <span
            className="theme-half"
            style={{ color: theme === 'dark' ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            <Moon size={14} />
          </span>
        </button>

        <div style={{ position: 'relative' }}>
          {/* Display-only identity chip (not an interactive control). */}
          <div
            className="hbtn hbtn-profile"
            title={user?.email || ''}
            style={{ cursor: 'default' }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: 'linear-gradient(135deg,#00e5c3,#08745f)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#041613',
                fontSize: 11,
                fontWeight: 800,
                flexShrink: 0
              }}
            >
              {(user?.username || 'R')[0].toUpperCase()}
            </span>
            <span
              className="hbtn-name"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 54
              }}
            >
              {user?.username || 'Raunak'}
            </span>
          </div>
        </div>
      </div>

      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="About CoinScan" width={500}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Logo size={44} withText={false} />
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>
                <span>Coin</span>
                <span className="teal">Scan</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>AI-powered coin identification &amp; numismatic exploration platform</div>
            </div>
          </div>
          <p style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--text-secondary)', margin: 0 }}>
            CoinScan uses computer vision to identify coins in seconds — from modern circulation to ancient
            masterpieces. Research history, track verified market values, grow your personal collection, trade
            with global collectors and convert currencies — all in one premium experience.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="badge badge-neutral">Version</span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>CoinScan 1.0.0</span>
          </div>
        </div>
      </Modal>
    </>
  )
}