import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, Coins, ExternalLink, Trash2, ScanSearch, Layers } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import GlassCard from '../components/GlassCard.jsx'
import Button from '../components/Button.jsx'
import PageLayout from '../components/PageLayout.jsx'

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

function persistHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
    window.dispatchEvent(new Event('coinscan-history'))
  } catch (e) {
    /* ignore */
  }
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

function itemCount(entry) {
  return Array.isArray(entry?.items) ? entry.items.length : 1
}

export default function HistoryPage() {
  const nav = useNavigate()
  const [history, setHistory] = useState(loadHistory)
  const [confirmClear, setConfirmClear] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    const refresh = () => {
      setHistory(loadHistory())
      setConfirmClear(false)
    }
    window.addEventListener('coinscan-history', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('coinscan-history', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 2400)
      return () => clearTimeout(t)
    }
  }, [toast])

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

  const removeEntry = (id) => {
    const next = history.filter((e) => e.id !== id)
    setHistory(next)
    persistHistory(next)
    setToast('Entry removed from upload history')
  }

  const clearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setHistory([])
    persistHistory([])
    setConfirmClear(false)
    setToast('Upload history cleared')
  }

  return (
    <PageLayout>
      <PageHeader
        compact
        eyebrow="Your Scans"
        title={<><span>Upload </span><span className="teal">History</span></>}
        subtitle="Every coin and note you've identified. Reopen any previous result in one click."
        right={
          history.length > 0 ? (
            <Button variant={confirmClear ? 'danger' : 'ghost'} size="md" onClick={clearAll}>
              <Trash2 size={15} /> {confirmClear ? 'Confirm Clear' : 'Clear All'}
            </Button>
          ) : null
        }
      />

      {history.length === 0 ? (
        <GlassCard className="glass-interior anim-fade-up" style={{ padding: 'clamp(28px, 4vw, 56px)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'rgba(0,229,195,0.1)',
              border: '1px solid var(--border-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
              boxShadow: 'var(--glow)'
            }}
          >
            <History size={28} />
          </div>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>No uploads yet</div>
          <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 420 }}>
            Scan your first coin and it will appear here automatically — ready to revisit anytime.
          </div>
          <Button variant="primary" size="md" onClick={() => nav('/home')} style={{ marginTop: 8, minWidth: 220 }}>
            <ScanSearch size={16} /> Scan a Coin
          </Button>
        </GlassCard>
      ) : (
        <>
          <div
            className="glass-card-soft"
            style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}
          >
            <Layers size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span>
              <strong style={{ color: 'var(--accent)' }}>{history.length} upload{history.length === 1 ? '' : 's'}</strong>
              &nbsp;stored on this device — click any card to reopen its full result.
            </span>
          </div>

          <div className="coin-grid" style={{ display: 'grid', gap: 14 }}>
            {history.map((entry, idx) => (
              <GlassCard
                key={entry.id}
                className={`glass-interior glass-card-hover anim-fade-up ${idx === 1 ? 'anim-delay-1' : idx === 2 ? 'anim-delay-2' : ''}`}
                style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer' }}
                onClick={() => openDetails(entry)}
              >
                <div
                  style={{
                    borderRadius: 14,
                    overflow: 'hidden',
                    border: '1px solid var(--border-faint)',
                    background: 'radial-gradient(120% 100% at 50% 0%, rgba(0,229,195,0.1), transparent 55%), #03110e',
                    height: 170,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {entry.image ? (
                    <img src={entry.image} alt={entry.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 10, display: 'block' }} />
                  ) : (
                    <Coins size={40} style={{ color: 'var(--accent)' }} />
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {entry.name || 'Identified Coin'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      {timeAgo(entry.timestamp)}
                      {itemCount(entry) > 1 ? ` · ${itemCount(entry)} items` : ''}
                    </div>
                  </div>
                  <span className="badge badge-success" style={{ flexShrink: 0 }}>
                    {itemCount(entry)} item{itemCount(entry) === 1 ? '' : 's'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="primary"
                    size="sm"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      openDetails(entry)
                    }}
                  >
                    <ExternalLink size={13} /> View Result
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    style={{ justifyContent: 'center' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeEntry(entry.id)
                    }}
                    aria-label={`Delete ${entry.name}`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {toast && (
        <div
          className="anim-fade-up"
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            background: 'var(--glass-bg-strong)',
            border: '1px solid var(--border-strong)',
            borderRadius: 14,
            padding: '12px 22px',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--accent)',
            backdropFilter: 'blur(14px)',
            boxShadow: 'var(--glow), var(--shadow-deep)'
          }}
        >
          {toast}
        </div>
      )}
    </PageLayout>
  )
}
