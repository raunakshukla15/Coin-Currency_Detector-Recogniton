export default function PageHeader({ eyebrow, title, subtitle, right = null, className = '', compact = false }) {
  return (
    <header className={className} style={{ marginBottom: compact ? 16 : 34 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <span className="eyebrow" style={compact ? { fontSize: 10, letterSpacing: '0.22em' } : undefined}>{eyebrow}</span>
          <h1
            className={compact ? undefined : 'heading-page anim-fade-up'}
            style={{
              ...(compact
                ? { fontSize: 'clamp(24px, 2.5vw, 32px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 800 }
                : {}),
              margin: compact ? '8px 0 6px' : '14px 0 10px'
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="anim-fade-up anim-delay-1"
              style={{ margin: 0, fontSize: compact ? 14 : 16, color: 'var(--text-muted)', maxWidth: 640, lineHeight: 1.6 }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {right}
      </div>
    </header>
  )
}