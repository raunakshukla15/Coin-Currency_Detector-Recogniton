import { useState, useEffect, useRef } from 'react'
import { Send, Star, Mail, Phone, MapPin, Users, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import GlassCard from '../components/GlassCard.jsx'
import PageLayout from '../components/PageLayout.jsx'
import { sendContact } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Display-only contact info shown on this page. Teams should replace these
// placeholders with their own public contact details before shipping.
const CONTACT_INFO = [
  { icon: Users, label: 'Made by', value: 'Team 5' },
  { icon: Phone, label: 'Contact Number', value: '9561119717' },
  { icon: Mail, label: 'Email', value: 'raunakbshukla133@gmail.com' },
  { icon: MapPin, label: 'Location', value: 'India' }
]

export default function Contact() {
  const { user } = useAuth()
  // rating 0 = "not rated" (stars untouched) — stored as-is by the backend.
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [formError, setFormError] = useState('')
  // Idempotency key: one per distinct message. A network retry of the SAME
  // text reuses the id, so the backend never stores or emails it twice.
  const submissionIdRef = useRef(null)
  // Outcome: null | {saved, emailSent, duplicate} — distinct states:
  //   saved+emailSent   -> confirmation says emailed
  //   saved+!emailSent  -> confirmation says saved, email could not be sent
  //   saved+duplicate   -> confirmation says already received (retry)
  //   (failure)         -> formError, no confirmation shown
  const [outcome, setOutcome] = useState(null)

  useEffect(() => {
    setName((n) => n || user?.username || '')
    setEmail((e) => e || user?.email || '')
  }, [user])

  const resetForm = () => {
    setOutcome(null)
    setRating(0)
    setText('')
    setName(user?.username || '')
    setEmail(user?.email || '')
    setFormError('')
    submissionIdRef.current = null
  }

  const submit = async () => {
    if (!text.trim() || sending) return
    setFormError('')
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setFormError('Please enter a valid email address (or leave it empty).')
      return
    }
    setSending(true)
    if (!submissionIdRef.current) {
      submissionIdRef.current =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
    }
    try {
      const res = await sendContact({
        text: text.trim(),
        rating,
        email: email.trim(),
        username: name.trim(),
        submissionId: submissionIdRef.current
      })
      setOutcome({
        saved: res?.saved !== false,
        emailSent: Boolean(res?.emailSent),
        duplicate: Boolean(res?.duplicate)
      })
    } catch (e) {
      console.error('Contact submission failed:', e)
      setFormError(e?.message || 'Could not send your feedback. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <PageLayout>
      <PageHeader
        compact
        eyebrow="Get in touch"
        title={<><span>Contact </span><span className="teal">Us</span></>}
        subtitle="Have feedback or a question about CoinScan? Reach out to the team below."
      />

      <div className="contact-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(260px,0.6fr)', gap: 'clamp(16px, 2.2vw, 28px)', alignItems: 'start' }}>
        <GlassCard className="glass-interior anim-fade-up" style={{ padding: 'clamp(18px, 2vw, 26px)' }}>
          {outcome ? (
            <div
              data-testid="contact-success"
              style={{ textAlign: 'center', padding: '40px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
            >
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,229,195,0.12)', border: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {outcome.duplicate || outcome.emailSent ? (
                  <CheckCircle2 size={22} style={{ color: 'var(--accent)' }} />
                ) : (
                  <AlertTriangle size={22} style={{ color: '#f5b450' }} />
                )}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {outcome.duplicate
                  ? 'Thank you!'
                  : outcome.emailSent
                    ? 'Thank you!'
                    : 'Your feedback was saved'}
              </div>
              <div data-testid="contact-success-detail" style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 380 }}>
                {outcome.duplicate
                  ? 'Your feedback was already received — no need to send it again.'
                  : outcome.emailSent
                    ? 'Your message was saved and emailed to the team. The Team 5 reads every message.'
                    : 'Your message was saved on the server, but email delivery to the team failed — it is stored and will be visible to the team from the database.'}
              </div>
              <button className="btn btn-primary btn-md" data-testid="contact-send-another" onClick={resetForm} style={{ marginTop: 8 }}>
                <RefreshCw size={15} /> Send another message
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div className="label">Rate your experience</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <button
                      key={i}
                      onClick={() => setRating(i)}
                      aria-label={`${i} stars`}
                      data-testid={`rating-star-${i}`}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 4,
                        color: i <= rating ? '#f5c86a' : 'var(--text-faint)',
                        filter: i <= rating ? 'drop-shadow(0 0 6px rgba(245,200,106,0.5))' : 'none',
                        transition: 'transform .2s ease, color .2s ease',
                        transform: i <= rating ? 'scale(1.12)' : 'none'
                      }}
                    >
                      <Star size={28} fill={i <= rating ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="contact-name">Name</label>
                <input
                  id="contact-name"
                  className="input"
                  data-testid="contact-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  maxLength={40}
                  style={{ padding: 13 }}
                />
              </div>
              <div>
                <label className="label" htmlFor="contact-email">Email</label>
                <input
                  id="contact-email"
                  className="input"
                  data-testid="contact-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  maxLength={255}
                  style={{ padding: 13 }}
                />
              </div>
              <div>
                <label className="label" htmlFor="contact-message">Your feedback</label>
                <textarea
                  id="contact-message"
                  className="input"
                  data-testid="contact-message"
                  rows={6}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    submissionIdRef.current = null // new content -> new submission
                  }}
                  placeholder="Share your feedback or ask a question..."
                  maxLength={4000}
                  style={{ padding: 14, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              {formError && (
                <div data-testid="contact-error" style={{ fontSize: 13, color: '#f5828a', background: 'rgba(245,130,138,0.08)', border: '1px solid rgba(245,130,138,0.3)', borderRadius: 12, padding: '11px 14px', lineHeight: 1.5, alignSelf: 'flex-start' }}>
                  {formError}
                </div>
              )}
              <button
                className="btn btn-primary btn-md"
                data-testid="contact-submit"
                onClick={submit}
                disabled={!text.trim() || sending}
                style={{ alignSelf: 'flex-start', minWidth: 180 }}
              >
                <Send size={16} /> {sending ? 'Sending…' : 'Send Feedback'}
              </button>
            </div>
          )}
        </GlassCard>

        <GlassCard className="glass-interior anim-fade-up anim-delay-1" style={{ padding: 20 }}>
          <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '0.28em' }}>Contact Details</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
            {CONTACT_INFO.map(({ icon: Icon, label, value }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,229,195,0.08)',
                    border: '1px solid var(--border-faint)',
                    color: 'var(--accent)'
                  }}
                >
                  <Icon size={16} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 2, wordBreak: 'break-word' }}>{value}</div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </PageLayout>
  )
}
