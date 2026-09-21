import { ChevronDown } from 'lucide-react'
import { currencies } from '../data/currencies.js'

export default function CurrencySelector({ value, onChange, exclude = '', className = '' }) {
  const options = Object.values(currencies).filter((c) => c.code !== exclude)
  return (
    <div className={`input-wrap ${className}`} style={{ position: 'relative' }}>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          paddingRight: 42,
          cursor: 'pointer',
          height: 50,
          fontSize: 15,
          lineHeight: 1.1,
          color: 'var(--text-primary)',
          padding: '0 42px 0 18px'
        }}
      >
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.symbol} {c.code} — {c.name}
          </option>
        ))}
      </select>
      <ChevronDown
        size={17}
        style={{
          position: 'absolute',
          right: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-faint)',
          pointerEvents: 'none'
        }}
      />
    </div>
  )
}