import { useId } from 'react'

export default function Chart({
  data,
  height = 260,
  showAxis = true,
  endLabel = null,
  color = '#00e5c3',
  format = (v) => v,
  className = ''
}) {
  const uid = useId().replace(/[:]/g, '')
  if (!data || data.length < 2) return null

  const W = 720
  const H = 260
  const padL = 18
  const padR = 18
  const padT = 18
  const padB = 34

  const vals = data.map((d) => d.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1

  const px = (i) => padL + (i / (data.length - 1)) * (W - padL - padR)
  const py = (v) => padT + (1 - (v - min) / range) * (H - padT - padB)

  const points = data.map((d, i) => [px(i), py(d.value)])
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L ${px(data.length - 1).toFixed(1)} ${H - padB} L ${px(0).toFixed(1)} ${H - padB} Z`
  const last = points[points.length - 1]

  const gridY = [0.25, 0.5, 0.75].map((f) => padT + f * (H - padT - padB))

  return (
    <div className={className} style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${uid}-glow`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={color} stopOpacity="0.9" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>

        {showAxis &&
          gridY.map((y, i) => (
            <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(0,229,195,0.1)" strokeWidth="1" strokeDasharray="3 6" />
          ))}

        <path d={area} fill={`url(#${uid}-area)`} />

        <path d={line} fill="none" stroke={color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${color}66)` }} />

        {/* glow dot on last point */}
        {endLabel !== null && (
          <>
            <circle cx={last[0]} cy={last[1]} r="16" fill={`url(#${uid}-glow)`} />
            <circle cx={last[0]} cy={last[1]} r="5" fill={color} />
            <circle cx={last[0]} cy={last[1]} r="5" fill="#041613" opacity="0.4" />
            <circle cx={last[0]} cy={last[1]} r="2.2" fill="#fff" opacity="0.9" />
          </>
        )}

        {showAxis &&
          data.map((d, i) => (
            <text
              key={i}
              x={px(i)}
              y={H - 12}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-faint)"
            >
              {d.date}
            </text>
          ))}

        {endLabel !== null && (
          <text
            x={last[0]}
            y={Math.max(padT + 12, last[1] - 16)}
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill={color}
          >
            {endLabel}
          </text>
        )}
      </svg>
    </div>
  )
}

export function MiniSpark({ data, color = '#00e5c3', height = 44 }) {
  const uid = useId().replace(/[:]/g, '')
  if (!data || data.length < 2) return null
  const W = 120
  const H = 44
  const vals = data.map((d) => d.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const px = (i) => (i / (data.length - 1)) * (W - 8) + 4
  const py = (v) => 4 + (1 - (v - min) / range) * (H - 8)
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(d.value).toFixed(1)}`).join(' ')
  const area = `${line} L ${px(data.length - 1).toFixed(1)} ${H} L ${px(0).toFixed(1)} ${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }}>
      <defs>
        <linearGradient id={`${uid}-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid}-a)`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}