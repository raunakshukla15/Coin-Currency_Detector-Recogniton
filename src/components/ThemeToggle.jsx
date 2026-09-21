import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../context/ThemeContext.jsx'

export default function ThemeToggle({ size = 34 }) {
  const { theme, toggleTheme } = useTheme()
  return (
    <button
      aria-label="Toggle theme"
      onClick={toggleTheme}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        borderRadius: 999,
        border: '1px solid var(--border-soft)',
        background: 'var(--glass-bg-soft)',
        backdropFilter: 'blur(10px)',
        cursor: 'pointer',
        transition: 'all .25s ease'
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size - 8,
          height: size - 8,
          borderRadius: 999,
          color: theme === 'light' ? '#041613' : 'var(--text-muted)',
          background: theme === 'light' ? 'linear-gradient(135deg,#00e5c3,#00a98f)' : 'transparent',
          boxShadow: theme === 'light' ? 'var(--glow)' : 'none',
          transition: 'all .25s ease'
        }}
      >
        <Sun size={16} />
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size - 8,
          height: size - 8,
          borderRadius: 999,
          color: theme === 'dark' ? '#041613' : 'var(--text-muted)',
          background: theme === 'dark' ? 'linear-gradient(135deg,#00e5c3,#00a98f)' : 'transparent',
          boxShadow: theme === 'dark' ? 'var(--glow)' : 'none',
          transition: 'all .25s ease'
        }}
      >
        <Moon size={16} />
      </span>
    </button>
  )
}