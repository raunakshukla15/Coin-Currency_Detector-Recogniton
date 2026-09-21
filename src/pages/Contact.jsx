import { useState, useEffect } from 'react'
import { Send, Star, Mail, Phone, MapPin, Users } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import GlassCard from '../components/GlassCard.jsx'
import PageLayout from '../components/PageLayout.jsx'
import { sendContact } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'

const CONTACT_INFO = [
  { icon: Users, label: 'Made by', value: 'Team 5' },
  { icon: Phone, label: 'Contact Number', value: '9561119717' },
  { icon: Mail, label: 'Email', value: 'raunakbshukla133@gmail.com' },
  { icon: MapPin, label: 'Location', value: 'Earth' }
]

export default function Contact() {
  const { user } = useAuth()
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!sent) return
    const t = setTimeout(() => {
      setSent(false)
      setRating(0)
      setText('')
    }, 2500)
    return () => clearTimeout(t)
  }, [sent])

  const submit = async () => {
    if (!text.trim()) return
    try {
      const all = JSON.parse(localStorage.getItem('coinscan_feedback') || '[]')
      all.push({ text: text.trim(), rating, at: new Date().toISOString() })
      localStorage.setItem('coinscan_feedback', JSON.stringify(all))
    } catch (e) {
      /* ignore */
    }
    try {
      await sendContact({
        text: text.trim(),
        rating,
        email: user?.email || '',
        username: user?.username || ''
      })
    } catch (e) {
      console.error('Contact submission failed (backend unreachable):', e)
    }
    setSent(true)
  }

  return (
    <PageLayout>
      <PageHeader
        compact
        eyebrow="Get in touch"
        title={<><span>Contact </span><span className="teal">Us</span></>}
        subtitle="Have feedback or a question about CoinScan? Reach out to the team below."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(260px,0.6fr)', gap: 'clamp(16px, 2.2vw, 28px)', alignItems: 'start' }}>
        <GlassCard className="glass-interior anim-fade-up" style={{ padding: 'clamp(18px, 2vw, 26px)' }}>
          {sent ? (
            <div style={{ textAlign: 'center', padding: '40px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,229,195,0.12)', border: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Send size={22} style={{ color: 'var(--accent)' }} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Thank you!</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Your feedback has been recorded. The Team 5 reads every message.</div>
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
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
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
                <div className="label">Your feedback</div>
                <textarea
                  className="input"
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Share your feedback or ask a question..."
                  style={{ padding: 14, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              <button className="btn btn-primary btn-md" onClick={submit} disabled={!text.trim()} style={{ alignSelf: 'flex-start', minWidth: 180 }}>
                <Send size={16} /> Send Feedback
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