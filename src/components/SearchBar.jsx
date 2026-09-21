import { Search } from 'lucide-react'

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  size = 'md',
  className = ''
}) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        flex: 1,
        maxWidth: size === 'lg' ? 'none' : 420
      }}
    >
      <Search
        size={16}
        style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
      />
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: size === 'lg' ? '18px 20px 18px 46px' : '11px 14px 11px 42px',
          fontSize: size === 'lg' ? 16 : 14,
          borderRadius: size === 'lg' ? 16 : 12
        }}
        aria-label={placeholder}
      />
    </div>
  )
}