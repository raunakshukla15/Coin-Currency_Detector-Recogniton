import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { User, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react'
import Logo from '../components/Logo.jsx'
import BackgroundFX from '../components/BackgroundFX.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState({})
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  // One-shot success notice after account deletion. The flag is written by
  // the deletion flow and consumed here; re-checked on every location change
  // because RequireAuth may mount this page before the flag exists.
  const [accountDeleted, setAccountDeleted] = useState(false)
  useEffect(() => {
    try {
      if (sessionStorage.getItem('coinscan_account_deleted')) {
        sessionStorage.removeItem('coinscan_account_deleted')
        setAccountDeleted(true)
      }
    } catch (e) {
      /* ignore */
    }
  }, [loc])

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!identifier.trim()) errs.identifier = 'Please enter your username or email.'
    if (!password) errs.password = 'Please enter your password.'
    if (password && password.length < 4) errs.password = 'Password must be at least 4 characters.'
    setErrors(errs)
    setFormError('')
    if (Object.keys(errs).length) {
      setShake(true)
      setTimeout(() => setShake(false), 500)
      return
    }
    setBusy(true)
    const res = await login(identifier.trim(), password)
    setBusy(false)
    if (!res.ok) {
      setFormError(res.error || 'Unable to log in. Please try again.')
      return
    }
    nav('/home')
  }

  const inputStyle = {
    padding: '14px 16px 14px 46px',
    height: 52,
    borderRadius: 14
  }

  return (
    <div className="auth-wrap">
      <BackgroundFX intensity="max" />
      <div className="auth-sheen" aria-hidden="true" />

      <div style={{ position: 'absolute', top: 0, left: 0, padding: 30, zIndex: 10 }}>
        <Logo size={34} />
      </div>

      <div className="auth-panel">
        <div
          className="glass-card anim-fade-up"
          style={{ width: '100%', maxWidth: 580, padding: 'clamp(28px, 3.4vw, 48px)', borderRadius: 26 }}
        >
            <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
              Welcome to Coin
              <span className="teal">Scan</span>
            </h2>
            <p style={{ margin: 0, fontSize: 15, color: 'var(--text-muted)' }}>Log in to continue your journey</p>

            {accountDeleted && (
              <div
                data-testid="account-deleted-notice"
                style={{
                  marginTop: 18,
                  fontSize: 13,
                  color: 'var(--accent)',
                  background: 'rgba(0,229,195,0.08)',
                  border: '1px solid rgba(0,229,195,0.3)',
                  borderRadius: 12,
                  padding: '11px 14px',
                  lineHeight: 1.5
                }}
              >
                Your account and all of its data have been permanently deleted.
              </div>
            )}

            <form onSubmit={submit} style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 18 }} noValidate>
              <div>
                <label className="label" htmlFor="identifier">Username / Email</label>
                <div style={{ position: 'relative' }}>
                  <User size={17} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
                  <input
                    id="identifier"
                    className="input"
                    placeholder="you@example.com"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    style={{ ...inputStyle, borderColor: errors.identifier ? 'rgba(245,130,138,0.7)' : undefined }}
                  />
                </div>
                {errors.identifier && <div style={{ fontSize: 12.5, color: '#f5828a', marginTop: 6 }}>{errors.identifier}</div>}
              </div>

              <div>
                <label className="label" htmlFor="password">Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={17} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
                  <input
                    id="password"
                    className="input"
                    type={show ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ ...inputStyle, borderColor: errors.password ? 'rgba(245,130,138,0.7)' : undefined }}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}
                  >
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {errors.password && <div style={{ fontSize: 12.5, color: '#f5828a', marginTop: 6 }}>{errors.password}</div>}
              </div>

              {formError && (
                <div style={{ fontSize: 13, color: '#f5828a', background: 'rgba(245,130,138,0.08)', border: '1px solid rgba(245,130,138,0.3)', borderRadius: 12, padding: '11px 14px', lineHeight: 1.5 }}>
                  {formError}
                </div>
              )}

              <button type="submit" className="btn btn-primary btn-lg anim-fade-up anim-delay-2" style={{ marginTop: 6, animationDelay: '0.3s', ...(shake ? { animation: 'fade-up .5s' } : {}), opacity: busy ? 0.7 : 1 }} disabled={busy}>
                {busy ? 'Logging in…' : <>Log In <ArrowRight size={19} /></>}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '26px 0' }}>
              <div className="divider-solid" style={{ flex: 1 }} />
              <span style={{ fontSize: 12, letterSpacing: '0.2em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>OR</span>
              <div className="divider-solid" style={{ flex: 1 }} />
            </div>

            <div style={{ textAlign: 'center', fontSize: 15, color: 'var(--text-muted)' }}>
              Don't have an account?{' '}
              <Link to="/signup" className="link-teal" style={{ fontWeight: 600 }}>Sign Up</Link>
            </div>
          </div>
      </div>
    </div>
  )
}