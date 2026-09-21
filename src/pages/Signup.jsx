import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { User, Mail, Lock, Eye, EyeOff, ArrowRight, CheckCircle2 } from 'lucide-react'
import Logo from '../components/Logo.jsx'
import BackgroundFX from '../components/BackgroundFX.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Signup() {
  const nav = useNavigate()
  const { signup } = useAuth()
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' })
  const [show, setShow] = useState({ p: false, c: false })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.username.trim()) errs.username = 'Username is required.'
    else if (form.username.trim().length < 3) errs.username = 'Username must be at least 3 characters.'
    if (!form.email.trim()) errs.email = 'Email is required.'
    else if (!EMAIL_RE.test(form.email)) errs.email = 'Please enter a valid email address.'
    if (!form.password) errs.password = 'Password is required.'
    else if (form.password.length < 6) errs.password = 'Password must be at least 6 characters.'
    if (!form.confirm) errs.confirm = 'Please confirm your password.'
    else if (form.confirm !== form.password) errs.confirm = 'Passwords do not match.'
    setErrors(errs)
    setFormError('')
    if (Object.keys(errs).length) return
    setBusy(true)
    const res = await signup(form.username.trim(), form.email.trim(), form.password)
    setBusy(false)
    if (!res.ok) {
      setFormError(res.error || 'Unable to create account. Please try again.')
      return
    }
    nav('/home')
  }

  const field = (key, label, IconComp, type, props = {}) => {
    const { showKey, ...rest } = props
    return (
      <div>
        <label className="label" htmlFor={key}>{label}</label>
        <div style={{ position: 'relative' }}>
          <IconComp size={17} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <input
            id={key}
            className="input"
            type={showKey ? (show[showKey] ? 'text' : 'password') : type}
            value={form[key]}
            onChange={set(key)}
            style={{ padding: '14px 46px', height: 52, borderRadius: 14, borderColor: errors[key] ? 'rgba(245,130,138,0.7)' : undefined }}
            {...rest}
          />
          {showKey && (
            <button
              type="button"
              onClick={() => setShow((s) => ({ ...s, [showKey]: !s[showKey] }))}
              aria-label={show[showKey] ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
              style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}
            >
              {show[showKey] ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          )}
        </div>
        {errors[key] && <div style={{ fontSize: 12.5, color: '#f5828a', marginTop: 6 }}>{errors[key]}</div>}
      </div>
    )
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
              Create Your <span className="teal">Account</span>
            </h2>
            <p style={{ margin: 0, fontSize: 15, color: 'var(--text-muted)' }}>Join CoinScan and start your journey</p>

            <form onSubmit={submit} style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
              {field('username', 'Username', User, 'text', { placeholder: 'Your display name' })}
              {field('email', 'Email', Mail, 'email', { placeholder: 'you@example.com' })}
              {field('password', 'Password', Lock, 'password', { placeholder: '••••••••', minLength: 6, showKey: 'p' })}
              {field('confirm', 'Confirm Password', Lock, 'password', { placeholder: '••••••••', showKey: 'c' })}

              {formError && (
                <div style={{ fontSize: 13, color: '#f5828a', background: 'rgba(245,130,138,0.08)', border: '1px solid rgba(245,130,138,0.3)', borderRadius: 12, padding: '11px 14px', lineHeight: 1.5 }}>
                  {formError}
                </div>
              )}

              <button type="submit" className="btn btn-primary btn-lg" style={{ marginTop: 6, opacity: busy ? 0.7 : 1 }} disabled={busy}>
                {busy ? 'Creating account…' : <>Create Account <ArrowRight size={19} /></>}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '24px 0' }}>
              <div className="divider-solid" style={{ flex: 1 }} />
              <span style={{ fontSize: 12, letterSpacing: '0.2em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>OR</span>
              <div className="divider-solid" style={{ flex: 1 }} />
            </div>

            <div style={{ textAlign: 'center', fontSize: 15, color: 'var(--text-muted)' }}>
              Already have an account?{' '}
              <Link to="/login" className="link-teal" style={{ fontWeight: 600 }}>Log In</Link>
            </div>
          </div>
      </div>
    </div>
  )
}