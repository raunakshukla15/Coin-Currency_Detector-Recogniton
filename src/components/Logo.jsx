export default function Logo({ size = 34, withText = true, className = '' }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 11 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        style={{ filter: 'drop-shadow(0 0 12px rgba(0,229,195,0.45))', flexShrink: 0 }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="cs-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#37f5d8" />
            <stop offset="0.55" stopColor="#00cfaf" />
            <stop offset="1" stopColor="#08745f" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="38" height="38" rx="11" fill="rgba(3,25,21,0.9)" stroke="rgba(0,229,195,0.4)" strokeWidth="1.2" />
        <ellipse cx="20" cy="11" rx="11" ry="4.4" fill="url(#cs-g)" />
        <ellipse cx="20" cy="20" rx="11" ry="4.4" fill="url(#cs-g)" opacity="0.72" />
        <ellipse cx="20" cy="29" rx="11" ry="4.4" fill="url(#cs-g)" opacity="0.45" />
        <ellipse cx="20" cy="11" rx="11" ry="4.4" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
      </svg>
      {withText && (
        <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>
          <span style={{ color: 'var(--text-primary)' }}>Coin</span>
          <span style={{ color: 'var(--accent)', textShadow: '0 0 14px rgba(0,229,195,0.55)' }}>Scan</span>
        </span>
      )}
    </span>
  )
}