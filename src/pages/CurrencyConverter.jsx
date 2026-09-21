import { useMemo, useState } from 'react'
import { ArrowRightLeft, Copy, Check, TrendingUp, TrendingDown } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import GlassCard from '../components/GlassCard.jsx'
import Chart from '../components/Chart.jsx'
import CurrencySelector from '../components/CurrencySelector.jsx'
import PageLayout from '../components/PageLayout.jsx'
import { currencies, convert, rate, weeklyTrend } from '../data/currencies.js'

export default function CurrencyConverter() {
  const [amount, setAmount] = useState(100)
  const [from, setFrom] = useState('INR')
  const [to, setTo] = useState('EUR')
  const [copied, setCopied] = useState(false)

  const result = convert(amount, from, to)
  const currentRate = rate(from, to)
  const trend = useMemo(() => weeklyTrend(from, to), [from, to])

  const last = trend[trend.length - 1]?.value || 0
  const prev = trend[trend.length - 2]?.value || 0
  const first = trend[0]?.value || 0
  const dailyChange = prev ? ((last - prev) / prev) * 100 : 0
  const weekChange = first ? ((last - first) / first) * 100 : 0
  const high = Math.max(...trend.map((t) => t.value))
  const low = Math.min(...trend.map((t) => t.value))
  const positive = dailyChange >= 0

  const sym = currencies[from]?.symbol || ''
  const toSym = currencies[to]?.symbol || ''

  const selectFrom = (code) => {
    if (code === to) setTo(from)
    setFrom(code)
  }

  const swap = () => setFrom((f) => {
    setTo(f)
    return to
  })

  const copy = async () => {
    const text = `${amount} ${from} = ${result.toFixed(4)} ${to} (1 ${from} = ${currentRate.toFixed(4)} ${to})`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      /* ignore */
    }
  }

  return (
    <PageLayout>
      <div
        style={{
          height: 'calc(100vh - 70px)',
          minHeight: 520,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}
      >
        <PageHeader
          compact
          eyebrow="Currency Converter"
          title={<><span>Convert </span><span className="teal">Currencies</span></>}
          subtitle="Simple, instant conversion between global currencies."
        />

        <div
          className="convert-grid"
          style={{ flex: 1, minHeight: 0, gap: 16, alignItems: 'stretch' }}
        >
          {/* LEFT — trend + insights */}
          <GlassCard
            className="glass-interior anim-fade-up"
            style={{ padding: 'clamp(16px, 1.8vw, 24px)', display: 'flex', flexDirection: 'column', minHeight: 0 }}
          >
            <div className="eyebrow" style={{ marginBottom: 8 }}>Trend &amp; Insights</div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
                  {from} <span style={{ color: 'var(--text-faint)' }}>→</span> {to}
                </div>
                <div style={{ fontSize: 'clamp(18px, 2vw, 24px)', fontWeight: 800, color: 'var(--accent)', marginTop: 2 }}>
                  1 {from} = {currentRate.toFixed(4)} {to}
                </div>
              </div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 13px',
                  borderRadius: 999,
                  background: positive ? 'rgba(0,229,195,0.1)' : 'rgba(245,130,138,0.1)',
                  border: `1px solid ${positive ? 'var(--border-strong)' : 'rgba(245,130,138,0.35)'}`,
                  color: positive ? 'var(--accent)' : '#f5828a',
                  fontWeight: 700,
                  fontSize: 13,
                  boxShadow: positive ? 'var(--glow-soft)' : 'none'
                }}
              >
                {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {positive ? '+' : ''}{dailyChange.toFixed(2)}% today
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 170, marginTop: 14 }} className="chart-fill">
              <Chart data={trend} endLabel={currentRate.toFixed(4)} />
            </div>

            <div className="divider-solid" style={{ margin: '14px 0' }} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                ['7-Day Change', `${positive ? '+' : ''}${weekChange.toFixed(2)}%`, positive ? 'var(--accent)' : '#f5828a'],
                ['Period High', high.toFixed(4), 'var(--text-primary)'],
                ['Period Low', low.toFixed(4), 'var(--text-secondary)']
              ].map(([label, value, color]) => (
                <div key={label} className="glass-card-soft" style={{ padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, marginTop: 5, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* RIGHT — converter */}
          <GlassCard
            className="glass-interior anim-fade-up anim-delay-1"
            style={{ padding: 'clamp(16px, 1.8vw, 24px)', display: 'flex', flexDirection: 'column', minHeight: 0 }}
          >
            <div className="eyebrow" style={{ marginBottom: 18 }}>Converter</div>

            <div className="label">Amount</div>
            <div style={{ position: 'relative' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 22,
                  fontWeight: 800,
                  color: 'var(--accent)',
                  pointerEvents: 'none'
                }}
              >
                {sym || '$'}
              </span>
              <input
                className="input"
                type="number"
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder="0.00"
                style={{ padding: '14px 16px 14px 48px', fontSize: 24, fontWeight: 800, height: 60, borderRadius: 16, fontVariantNumeric: 'tabular-nums' }}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="label">From</div>
              <CurrencySelector value={from} onChange={selectFrom} exclude={to} />
            </div>

            <div style={{ position: 'relative', margin: '12px 0' }}>
              <div className="divider" />
              <button
                onClick={swap}
                aria-label="Swap currencies"
                title="Swap currencies"
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%,-50%)',
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg,#00e5c3,#00a98f)',
                  border: 'none',
                  color: '#041613',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: 'var(--glow-strong), 0 8px 24px rgba(0,229,195,0.3)',
                  transition: 'transform .3s ease, box-shadow .3s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'translate(-50%,-50%) rotate(180deg)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'translate(-50%,-50%) rotate(0deg)')}
              >
                <ArrowRightLeft size={20} />
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div className="label">To</div>
              <CurrencySelector value={to} onChange={setTo} exclude={from} />
            </div>

            <div>
              <div className="label">Converted Result</div>
              <div
                style={{
                  position: 'relative',
                  padding: '14px 16px 14px 48px',
                  fontSize: 24,
                  fontWeight: 800,
                  height: 60,
                  borderRadius: 16,
                  border: '1px solid var(--border-strong)',
                  background: 'rgba(0,229,195,0.05)',
                  color: 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                  display: 'flex',
                  alignItems: 'center',
                  boxShadow: 'var(--glow-soft)'
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 22,
                    fontWeight: 800,
                    color: 'var(--accent)',
                    pointerEvents: 'none'
                  }}
                >
                  {toSym}
                </span>
                {amount ? result.toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '0.00'}
              </div>
            </div>

            <div
              style={{
                marginTop: 'auto',
                paddingTop: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap'
              }}
            >
              <div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                1 {from} = <strong style={{ color: 'var(--text-secondary)' }}>{currentRate.toFixed(4)} {to}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
                  <span className="kbd live-dot" style={{ display: 'inline-block', marginRight: 6 }} />
                  Live rates · Updated just now
                </div>
              </div>
              <button
                className="btn btn-outline btn-sm"
                onClick={copy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 96, justifyContent: 'center' }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </GlassCard>
        </div>
      </div>
    </PageLayout>
  )
}