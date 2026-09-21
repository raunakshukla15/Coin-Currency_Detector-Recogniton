import { useId } from 'react'

const METAL = {
  gold: {
    ring: ['#f0d492', '#c8973d', '#8a5f1d', '#e9c97e'],
    stroke: '#6b4a1e',
    text: '#4a3410',
    center: ['#fdf3d3', '#e6bd6d', '#c08f3c']
  },
  silver: {
    ring: ['#fbfcfe', '#cdd6de', '#8b97a3', '#e3e9ee'],
    stroke: '#5f6b76',
    text: '#2e3942',
    center: ['#f4f7f9', '#ccd5dc', '#9aa6b0']
  },
  bronze: {
    ring: ['#dfa876', '#b07a4e', '#6f4526', '#d69a66'],
    stroke: '#53331d',
    text: '#3a2312',
    center: ['#f0cba0', '#c08a58', '#8f5c35']
  },
  goldsilver: {
    ring: ['#f6e3b0', '#d5a44a', '#96701f', '#efd391'],
    stroke: '#5f4716',
    text: '#46330f',
    center: ['#fbf0d0', '#e3b96a', '#bd8f3d']
  },
  dark: {
    ring: ['#1a2f2a', '#0d1f1b', '#06120f', '#163029'],
    stroke: '#00e5c3',
    text: '#00e5c3',
    center: ['#123029', '#0a211c', '#041611']
  }
}

function RingGrads({ id, metal, centerMetal = metal }) {
  const m = METAL[metal] || METAL.silver
  const c = METAL[centerMetal] || METAL.silver
  const gid = `${id}-g`
  return (
    <defs>
      <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={m.ring[0]} />
        <stop offset="30%" stopColor={m.ring[1]} />
        <stop offset="62%" stopColor={m.ring[2]} />
        <stop offset="100%" stopColor={m.ring[3]} />
      </linearGradient>
      <radialGradient id={`${id}-sheen`} cx="0.34" cy="0.28" r="0.9">
        <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
        <stop offset="45%" stopColor="rgba(255,255,255,0.06)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0.22)" />
      </radialGradient>
      <radialGradient id={`${id}-vignette`} cx="0.5" cy="0.5" r="0.52">
        <stop offset="0%" stopColor="rgba(0,0,0,0)" />
        <stop offset="82%" stopColor="rgba(0,0,0,0.08)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
      </radialGradient>
      <radialGradient id={`${id}-center`} cx="0.35" cy="0.3" r="0.95">
        <stop offset="0%" stopColor={c.center[0]} />
        <stop offset="60%" stopColor={c.center[1]} />
        <stop offset="100%" stopColor={c.center[2]} />
      </radialGradient>
    </defs>
  )
}

function Knurl({ id, metal }) {
  const m = (METAL[metal] || METAL.silver).stroke
  const ticks = []
  const N = 108
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const x1 = 120 + Math.cos(a) * 109
    const y1 = 120 + Math.sin(a) * 109
    const x2 = 120 + Math.cos(a) * 116
    const y2 = 120 + Math.sin(a) * 116
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={m} strokeWidth="1.6" opacity="0.55" />)
  }
  return <g>{ticks}</g>
}

function ArcText({ id, d, children, size = 11, spacing = 2, offset = '50%', weight = 700 }) {
  const p = `${id}-arc`
  return (
    <g>
      <path id={p} d={d} fill="none" stroke="none" />
      <text
        fontSize={size}
        fontWeight={weight}
        letterSpacing={spacing}
        fill="currentColor"
        fontFamily="Inter, 'Nirmala UI', sans-serif"
        textAnchor="middle"
      >
        <textPath href={`#${p}`} startOffset={offset}>
          {children}
        </textPath>
      </text>
    </g>
  )
}

function AshokaChakra({ id }) {
  const spokes = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const x1 = 120 + Math.cos(a) * 24
    const y1 = 120 + Math.sin(a) * 24
    const x2 = 120 + Math.cos(a) * 34
    const y2 = 120 + Math.sin(a) * 34
    spokes.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.3" opacity="0.85" />)
  }
  return (
    <g style={{ color: 'var(--coin-detail, #1c2a2a)' }}>
      {spokes}
      <circle cx="120" cy="120" r="34" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.9" />
      <circle cx="120" cy="120" r="24" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.6" />
      <circle cx="120" cy="120" r="5.5" fill="currentColor" />
    </g>
  )
}

function Owl({ height = 56, style = {} }) {
  const cx = 120
  const cy = 122
  return (
    <g transform={`translate(${cx} ${cy})`} style={{ color: 'var(--coin-detail, #2e3a3a)', ...style }}>
      <ellipse cx="0" cy="8" rx="24" ry="30" fill="currentColor" opacity="0.94" />
      <circle cx="0" cy="-20" r="17" fill="currentColor" opacity="0.97" />
      <ellipse cx="-11" cy="-20" rx="4.4" ry="6.6" fill="#f5e9c8" opacity="0.95" />
      <ellipse cx="11" cy="-20" rx="4.4" ry="6.6" fill="#f5e9c8" opacity="0.95" />
      <circle cx="-11" cy="-20" r="2.2" fill="#1d2a26" />
      <circle cx="11" cy="-20" r="2.2" fill="#1d2a26" />
      <path d="M -3 -12 L 0 -7 L 3 -12 Z" fill="#1d2a26" opacity="0.9" />
      <path d="M -12 -2 Q 0 6 12 -2" fill="none" stroke="#1d2a26" strokeWidth="1.6" opacity="0.6" />
      <path d="M -6 16 Q -14 24 -6 34" fill="none" stroke="#1d2a26" strokeWidth="1.4" opacity="0.55" />
      <path d="M 6 16 Q 14 24 6 34" fill="none" stroke="#1d2a26" strokeWidth="1.4" opacity="0.55" />
      <line x1="-7" y1="38" x2="-9" y2="43" stroke="#1d2a26" strokeWidth="1.8" opacity="0.8" />
      <line x1="7" y1="38" x2="9" y2="43" stroke="#1d2a26" strokeWidth="1.8" opacity="0.8" />
    </g>
  )
}

function SunRays({ id, count = 64 }) {
  const rays = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    const x1 = 120 + Math.cos(a) * 60
    const y1 = 120 + Math.sin(a) * 60
    const x2 = 120 + Math.cos(a) * 82
    const y2 = 120 + Math.sin(a) * 82
    rays.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.1" opacity="0.5" />)
  }
  return <g>{rays}</g>
}

function Wreath({ id, inner = 78, flip = false }) {
  const leaves = []
  const N = 22
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * Math.PI
    const angle = flip ? Math.PI - t : t
    const direction = flip ? 1 : -1
    const rx = 120 + Math.cos(angle) * inner
    const ry = 120 + Math.sin(angle) * inner
    const rot = (flip ? 180 - angle : angle) * (180 / Math.PI)
    const s = 3.4 + Math.sin(t) * 1.2
    leaves.push(
      <ellipse
        key={i}
        cx={rx}
        cy={ry}
        rx={s * 1.7}
        ry={s * 0.55}
        fill="currentColor"
        opacity="0.85"
        transform={`rotate(${rot + direction * 90} ${rx} ${ry})`}
      />
    )
  }
  return <g style={{ color: 'var(--coin-detail, #1c2a2a)' }}>{leaves}</g>
}

function Eagle({ id, small = false }) {
  return (
    <g transform="translate(120 118) scale(1)" style={{ color: 'var(--coin-detail, #1c2a2a)' }}>
      <path
        d="M 0 14 L 0 0 M -4 -6 L -30 -22 C -44 -28 -40 -14 -28 -8 L -10 2 M 4 -6 L 30 -22 C 44 -28 40 -14 28 -8 L 10 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M -10 -2 C -24 -2 -28 4 0 10 C 28 4 24 -2 10 -2 L 0 -2 Z"
        fill="currentColor"
        opacity="0.9"
      />
      <circle cx="0" cy="-14" r="5" fill="currentColor" />
      <path d="M -11 4 L -7 1 M 11 4 L 7 1" stroke="currentColor" strokeWidth="1.4" opacity="0.7" />
      <path d="M -24 -20 L -30 -26 M 24 -20 L 30 -26" stroke="currentColor" strokeWidth="1.6" opacity="0.8" />
      <line x1="-4" y1="10" x2="4" y2="10" stroke="currentColor" strokeWidth="1.6" />
    </g>
  )
}

function Bust({ id, laurel = false }) {
  return (
    <g transform="translate(120 128) scale(1.35)">
      <path
        d="M -14 18 C -18 4 -14 -6 -10 -10 C -8 -16 2 -20 8 -18 C 13 -17 15 -13 14 -9 C 18 -10 19 -6 16 -3 C 17 -1 14 1 12 1 C 12 4 9 5 10 8 C 11 10 8 12 7 10 C 5 14 -2 16 -8 16 Z"
        fill="currentColor"
      />
      <circle cx="1" cy="-11" r="1.3" fill="#111" opacity="0.8" />
    </g>
  )
}

function Crown({ id }) {
  return (
    <g transform="translate(120 128) scale(1.6)" style={{ color: 'var(--coin-detail, #1c2a2a)' }}>
      <path
        d="M -14 8 L -18 -4 L -6 0 L 0 -12 L 6 0 L 18 -4 L 14 8 Z"
        fill="currentColor"
      />
      <rect x="-13" y="8" width="26" height="2.4" fill="currentColor" opacity="0.9" />
      <circle cx="-9" cy="-9" r="1.4" fill="#f5e9c8" opacity="0.9" />
      <circle cx="0" cy="-14" r="1.4" fill="#f5e9c8" opacity="0.9" />
      <circle cx="9" cy="-9" r="1.4" fill="#f5e9c8" opacity="0.9" />
    </g>
  )
}

function WreathCircle() {
  return (
    <g>
      <circle cx="120" cy="120" r="40" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.6" />
      <circle cx="120" cy="120" r="47" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.35" />
    </g>
  )
}

function Details({ type, year }) {
  const detail = 'var(--coin-detail, #1c2a2a)'
  switch (type) {
    case 'rupee10': {
      return (
        <g style={{ color: detail }}>
          <AshokaChakra />
          <ArcText d="M 52 116 A 68 68 0 0 1 188 116" size={10.5} spacing={1.5}>
            सत्यमेव जयते
          </ArcText>
          <ArcText d="M 58 132 A 62 62 0 0 0 182 132" size={11} spacing={2.5}>
            भारत &nbsp;INDIA
          </ArcText>
        </g>
      )
    }
    case 'rupee10b': {
      return (
        <g style={{ color: detail }}>
          <SunRays />
          <circle cx="120" cy="118" r="48" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.65" />
          <text
            x="120"
            y="88"
            textAnchor="middle"
            fontSize="20"
            fontWeight="800"
            fill="#c98a2b"
            fontFamily="Inter, sans-serif"
          >
            ₹
          </text>
          <text
            x="120"
            y="142"
            textAnchor="middle"
            fontSize="52"
            fontWeight="800"
            fill={detail}
            fontFamily="Inter, sans-serif"
            letterSpacing="1"
          >
            10
          </text>
          <ArcText d="M 52 128 A 68 68 0 0 1 188 128" size={9.5} spacing={2}>
            दस रुपये · TEN RUPEES
          </ArcText>
        </g>
      )
    }
    case 'eic': {
      return (
        <g style={{ color: detail }}>
          <WreathCircle />
          <Wreath inner={46} />
          <text x="120" y="140" textAnchor="middle" fontSize="44" fontWeight="800" fill={detail}>
            1
          </text>
          <ArcText d="M 56 118 A 64 64 0 0 1 184 118" size={8.2} spacing={1.8}>
            EAST INDIA COMPANY
          </ArcText>
          <ArcText d="M 63 132 A 57 57 0 0 0 177 132" size={8} spacing={1.6}>
            ONE RUPEE · {year}
          </ArcText>
        </g>
      )
    }
    case 'tetradrachm': {
      return (
        <g style={{ color: detail }}>
          <Owl />
          <ArcText d="M 50 120 A 74 74 0 0 1 190 120" size={9} spacing={2.4}>
            ΑΘΕ - ΑΘΗΝΑΙΩΝ
          </ArcText>
          <path d="M 92 44 a 8 8 0 0 1 6 3" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          <path
            d="M 60 52 l 3 -8 l 3 4 m -6 4 l 3 -8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            opacity="0.5"
          />
        </g>
      )
    }
    case 'morgan': {
      return (
        <g style={{ color: detail }}>
          <ArcText d="M 50 116 A 74 74 0 0 1 190 116" size={9.5} spacing={3}>
            LIBERTY · ONE DOLLAR
          </ArcText>
          <Eagle />
          <ArcText d="M 58 136 A 62 62 0 0 0 182 136" size={8.5} spacing={2}>
            ★ ★ ★ · {year} · ★ ★ ★
          </ArcText>
          <circle cx="120" cy="52" r="9" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.6" />
        </g>
      )
    }
    case 'drape': {
      return (
        <g style={{ color: detail }}>
          <ArcText d="M 50 116 A 74 74 0 0 1 190 116" size={9} spacing={2.6}>
            LIBERTY · 1804
          </ArcText>
          <Eagle />
          <ArcText d="M 60 138 A 60 60 0 0 0 180 138" size={8.5} spacing={2}>
            UNUM E PLURIBUS
          </ArcText>
          <circle cx="120" cy="150" r="4" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
        </g>
      )
    }
    case 'anna': {
      return (
        <g style={{ color: detail }}>
          <ArcText d="M 50 116 A 74 74 0 0 1 190 116" size={9} spacing={2.2}>
            EDWARD VII KING EMPEROR
          </ArcText>
          <Crown />
          <ArcText d="M 60 138 A 60 60 0 0 0 180 138" size={8.5} spacing={1.8}>
            ONE ANNA · {year}
          </ArcText>
          <circle cx="120" cy="50" r="12" fill="currentColor" opacity="0.12" />
        </g>
      )
    }
    case 'sestertius': {
      return (
        <g style={{ color: detail }}>
          <WreathCircle />
          <Wreath inner={46} />
          <text x="120" y="136" textAnchor="middle" fontSize="40" fontWeight="800" fill={detail}>
            SC
          </text>
          <ArcText d="M 54 118 A 66 66 0 0 1 186 118" size={8} spacing={2}>
            ROMAN EMPIRE
          </ArcText>
          <ArcText d="M 63 134 A 57 57 0 0 0 177 134" size={7.5} spacing={1.6}>
            BRONZE · {year}
          </ArcText>
        </g>
      )
    }
    case 'commem': {
      return (
        <g style={{ color: detail }}>
          <SunRays count={48} />
          <AshokaChakra />
          <ArcText d="M 52 116 A 68 68 0 0 1 188 116" size={9} spacing={1.6}>
            भारत · INDEPENDENCE · INDIA
          </ArcText>
          <ArcText d="M 60 136 A 60 60 0 0 0 180 136" size={8} spacing={1.6}>
            {year} · स्वतंत्रता
          </ArcText>
          <circle cx="120" cy="120" r="44" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
        </g>
      )
    }
    case 'rupee1': {
      return (
        <g style={{ color: detail }}>
          <WreathCircle />
          <Wreath inner={46} />
          <text x="120" y="142" textAnchor="middle" fontSize="46" fontWeight="800" fill={detail}>
            1
          </text>
          <text x="92" y="118" textAnchor="middle" fontSize="14" fontWeight="700" fill="#c98a2b">
            ₹
          </text>
          <ArcText d="M 56 116 A 64 64 0 0 1 184 116" size={8} spacing={1.8}>
            FIVE RUPEES · India
          </ArcText>
          <ArcText d="M 63 134 A 57 57 0 0 0 177 134" size={8} spacing={1.8}>
            {year}
          </ArcText>
        </g>
      )
    }
    case 'kushan': {
      return (
        <g style={{ color: '#6b4a1e' }}>
          <ArcText d="M 50 118 A 70 70 0 0 1 190 118" size={8.5} spacing={2}>
            KUSHAN DYNASTY
          </ArcText>
          <Bust />
          <ArcText d="M 60 136 A 60 60 0 0 0 180 136" size={8} spacing={1.8}>
            GOLD DINAR · {year}
          </ArcText>
        </g>
      )
    }
    default:
      return (
        <g style={{ color: detail }}>
          <AshokaChakra />
          <ArcText d="M 52 116 A 68 68 0 0 1 188 116" size={10} spacing={2}>
            भारत INDIA
          </ArcText>
        </g>
      )
  }
}

const TYPE_METAL = {
  rupee10: 'gold',
  rupee1: 'silver',
  eic: 'silver',
  tetradrachm: 'silver',
  drape: 'silver',
  morgan: 'silver',
  anna: 'goldsilver',
  sestertius: 'bronze',
  commem: 'goldsilver',
  kushan: 'gold',
  rupee10b: 'gold',
}

const DETAIL_COLORS = {
  silver: '#22303a',
  gold: '#4a3410',
  goldsilver: '#4a3a12',
  bronze: '#3a2312'
}

export default function CoinImage({ coin, size = 220, className = '', glow = false }) {
  const uid = useId().replace(/[:]/g, '')
  const type = coin.type || 'rupee10'
  const metal = TYPE_METAL[type] || 'silver'
  const detail = DETAIL_COLORS[metal] || '#22303a'
  const showBack = type === 'rupee10b'
  const typeForDetails = showBack ? 'rupee10b' : type
  const centerMetal = type === 'rupee10' || type === 'rupee10b' ? 'silver' : metal

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: 'relative',
        filter: glow ? 'drop-shadow(0 0 18px rgba(0,229,195,0.35))' : 'none'
      }}
    >
      <svg
        viewBox="0 0 240 240"
        width={size}
        height={size}
        style={{
          display: 'block',
          overflow: 'visible',
          '--coin-detail': detail,
          color: detail
        }}
        role="img"
        aria-label={`${coin.name || 'Coin'} visual`}
      >
        <RingGrads id={uid} metal={metal} centerMetal={centerMetal} />
        <Knurl id={uid} metal={metal} />
        <circle cx="120" cy="120" r="113" fill={`url(#${uid}-g)`} stroke={METAL[metal].stroke} strokeWidth="1.4" />
        <circle cx="120" cy="120" r="113" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.6" />
        <circle cx="120" cy="120" r="107.5" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" />
        <circle cx="120" cy="120" r="86" fill={`url(#${uid}-center)`} />
        <circle cx="120" cy="120" r="86" fill="none" stroke={METAL[metal].stroke} strokeWidth="1.2" opacity="0.8" />
        <circle cx="120" cy="120" r="80" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1" />
        {metal === 'silver' || metal === 'goldsilver' ? (
          <>
            <circle cx="120" cy="120" r="84" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" />
            <circle cx="120" cy="120" r="48" fill="none" stroke="rgba(120,140,150,0.3)" strokeWidth="0.8" />
          </>
        ) : null}
        <Details type={typeForDetails} year={(coin && coin.year) || ''} />
        <circle cx="120" cy="120" r="113" fill={`url(#${uid}-sheen)`} />
        <circle cx="120" cy="120" r="113" fill={`url(#${uid}-vignette)`} />
      </svg>
    </div>
  )
}

export { METAL, TYPE_METAL }