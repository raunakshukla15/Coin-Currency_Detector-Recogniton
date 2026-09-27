import GlassCard from './GlassCard.jsx'

export default function StatCard({ icon: Icon, label, value, sub, trend = null, trendUp = true }) {
  return (
    <GlassCard hover className="glass-interior" style={{ padding: '22px 24px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {label}
          </div>
          <div className="stat-value" style={{ fontSize: 'clamp(28px,2.6vw,38px)', fontWeight: 800, letterSpacing: '-0.02em', marginTop: 10, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            {value}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 4 }}>
            {trend ? (
              <span style={{ color: trendUp ? 'var(--accent)' : '#f5828a', fontWeight: 600 }}>{trend}</span>
            ) : null}
            {sub ? ` ${sub}` : ''}
          </div>
        </div>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,229,195,0.1)',
            border: '1px solid rgba(0,229,195,0.3)',
            color: 'var(--accent)',
            boxShadow: 'var(--glow-soft)'
          }}
        >
          <Icon size={20} />
        </div>
      </div>
    </GlassCard>
  )
}