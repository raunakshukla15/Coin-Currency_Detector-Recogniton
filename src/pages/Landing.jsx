import { useNavigate } from 'react-router-dom'
import { ArrowRight, ScanLine } from 'lucide-react'
import Logo from '../components/Logo.jsx'
import BackgroundFX from '../components/BackgroundFX.jsx'

export default function Landing() {
  const nav = useNavigate()
  return (
    <div style={{ minHeight: '100vh', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <BackgroundFX intensity="max" />

      {/* Top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 'clamp(22px, 3vw, 46px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
        <Logo size={36} />
        <div className="landing-words" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.32em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {['Discover', 'Identify', 'Explore'].map((w, i) => (
            <span key={w} className="anim-fade-up" style={{ animationDelay: `${0.3 + i * 0.12}s` }}>
              {i === 1 ? <span className="teal">{w}</span> : w}
            </span>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 'clamp(84px, 15vh, 160px)',
          transform: 'translateX(-50%)',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          textAlign: 'center',
          padding: '0 20px'
        }}
      >
        <span
          className="anim-fade-up"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            background: 'rgba(2, 14, 12, 0.5)',
            border: '1px solid var(--border-soft)',
            borderRadius: 9999,
            padding: '9px 18px',
            backdropFilter: 'blur(8px)'
          }}
        >
          <ScanLine size={13} />
          AI-Powered Coin Identification
        </span>
        <button
          className="btn btn-primary btn-lg anim-fade-up"
          style={{ padding: '20px 54px', fontSize: 17, animationDelay: '0.25s', boxShadow: '0 0 46px rgba(0,229,195,0.45), 0 18px 50px rgba(0,0,0,0.55)' }}
          onClick={() => nav('/login')}
        >
          Get Started
          <ArrowRight size={20} />
        </button>
      </div>

      {/* bottom-trim glow */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 130,
          background: 'linear-gradient(180deg, transparent, rgba(0,229,195,0.05))',
          pointerEvents: 'none'
        }}
      />
    </div>
  )
}