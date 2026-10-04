import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Trash2, Lock, Eye, EyeOff } from 'lucide-react'
import Modal from './Modal.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const errorStyle = {
  fontSize: 13,
  color: '#f5828a',
  background: 'rgba(245,130,138,0.08)',
  border: '1px solid rgba(245,130,138,0.3)',
  borderRadius: 12,
  padding: '11px 14px',
  lineHeight: 1.5
}

export default function DeleteAccount() {
  const nav = useNavigate()
  const { deleteAccount } = useAuth()
  // 0 = closed, 1 = first confirmation, 2 = password confirmation
  const [step, setStep] = useState(0)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    if (busy) return
    setStep(0)
    setPassword('')
    setError('')
    setShow(false)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!password) {
      setError('Please enter your current password.')
      return
    }
    setBusy(true)
    setError('')
    const res = await deleteAccount(password)
    setBusy(false)
    setPassword('')
    setShow(false)
    if (res.ok) {
      setStep(0)
      // One-shot notice flag: the success message must survive the
      // RequireAuth -> /login redirect (which races this navigation and
      // carries no router state). Login consumes it immediately.
      try {
        sessionStorage.setItem('coinscan_account_deleted', '1')
      } catch (e) {
        /* ignore */
      }
      nav('/login', { replace: true })
    } else {
      setError(res.error || 'Account deletion failed. Please try again.')
    }
  }

  return (
    <>
      <button
        className="nav-item"
        data-testid="delete-account-trigger"
        onClick={() => {
          setError('')
          setStep(1)
        }}
        style={{ color: '#f5828a', flexShrink: 0 }}
      >
        <Trash2 size={18} />
        <span style={{ whiteSpace: 'nowrap' }}>Delete Account</span>
      </button>

      {/* Portalled to <body>: the sidebar uses overflow:hidden + backdrop-filter,
          which would clip/constrain a position:fixed modal rendered inside it. */}
      {createPortal(
        <>
          <Modal open={step === 1} onClose={close} title="Delete Account" width={480}>
            <div
              data-testid="delete-confirm-step1"
              style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
            >
              <p
                style={{
                  fontSize: 14.5,
                  lineHeight: 1.7,
                  color: 'var(--text-secondary)',
                  margin: 0
                }}
              >
                Deleting your account permanently removes your account credentials,
                upload history, collection, chat conversations, uploaded images, and
                any feedback you submitted from CoinScan. This action cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-ghost btn-md"
                  data-testid="delete-cancel-1"
                  onClick={close}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger btn-md"
                  data-testid="delete-continue"
                  onClick={() => {
                    setError('')
                    setPassword('')
                    setStep(2)
                  }}
                  disabled={busy}
                >
                  Continue
                </button>
              </div>
            </div>
          </Modal>

          <Modal
            open={step === 2}
            onClose={close}
            title="Confirm Permanent Deletion"
            width={480}
          >
            <form
              data-testid="delete-password-step2"
              onSubmit={submit}
              style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
              noValidate
            >
              <p
                style={{
                  fontSize: 14.5,
                  lineHeight: 1.7,
                  color: 'var(--text-secondary)',
                  margin: 0
                }}
              >
                This action is permanent and cannot be undone. Enter your current
                password to confirm deleting your account and all of its data.
              </p>

              <div>
                <label className="label" htmlFor="delete-password">
                  Current password
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock
                    size={17}
                    style={{
                      position: 'absolute',
                      left: 16,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-faint)'
                    }}
                  />
                  <input
                    id="delete-password"
                    data-testid="delete-password-input"
                    className="input"
                    type={show ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    style={{
                      padding: '14px 46px 14px 46px',
                      borderRadius: 14,
                      borderColor: error ? 'rgba(245,130,138,0.7)' : undefined
                    }}
                  />
                  <button
                    type="button"
                    data-testid="delete-password-toggle"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    style={{
                      position: 'absolute',
                      right: 14,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-faint)'
                    }}
                  >
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              {error && (
                <div data-testid="delete-error" style={errorStyle}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-md"
                  data-testid="delete-cancel-2"
                  onClick={close}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger btn-md"
                  data-testid="delete-submit"
                  disabled={busy}
                >
                  {busy ? 'Deleting…' : 'Permanently Delete Account'}
                </button>
              </div>
            </form>
          </Modal>
        </>,
        document.body
      )}
    </>
  )
}
