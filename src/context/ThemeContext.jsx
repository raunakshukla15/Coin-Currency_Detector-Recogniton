import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'coinscan_theme'

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved === 'light' ? 'light' : 'dark'
    } catch (e) {
      return 'dark'
    }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch (e) {
      /* ignore */
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}