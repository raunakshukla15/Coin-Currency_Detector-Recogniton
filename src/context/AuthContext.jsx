import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authLogin, authSignup, authLogout, authMe } from '../api.js'

const AuthContext = createContext(null)
const STORAGE_KEY = 'coinscan_auth'

function persist(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    /* ignore */
  }
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

// Page-derived session data (e.g. the last identification preview) is
// account-specific: clear it on every login/logout so one account's data
// can never surface for another account in the same browser tab.
function clearPageSessionData() {
  try {
    sessionStorage.removeItem('coinscan_lastident')
  } catch (e) {
    /* ignore */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const stored = loadStored()
    if (stored?.token) {
      authMe(stored.token)
        .then((u) => {
          setUser(u)
          setToken(stored.token)
        })
        .catch((e) => {
          const status = e?.status
          if (status === 401 || status === 403) {
            // Definitively invalid/expired session — drop it.
            try {
              localStorage.removeItem(STORAGE_KEY)
            } catch (err) {
              /* ignore */
            }
          } else if (stored?.user) {
            // Backend temporarily unreachable — keep the session and restore
            // the known user instead of logging the user out over a blip.
            setUser(stored.user)
            setToken(stored.token)
          } else {
            try {
              localStorage.removeItem(STORAGE_KEY)
            } catch (err) {
              /* ignore */
            }
          }
        })
        .finally(() => setReady(true))
    } else {
      if (stored?.demo) {
        // Legacy offline demo session — no longer supported.
        try {
          localStorage.removeItem(STORAGE_KEY)
        } catch (e) {
          /* ignore */
        }
      }
      setReady(true)
    }
  }, [])

  const applySession = (u, t) => {
    clearPageSessionData()
    setUser(u)
    setToken(t)
    persist({ user: u, token: t })
  }

  const login = useCallback(async (identifier, password) => {
    try {
      const res = await authLogin(identifier, password)
      const u = { ...res.user, id: res.user?.id, demo: false }
      applySession(u, res.token || null)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message || 'Unable to log in.' }
    }
  }, [])

  const signup = useCallback(async (username, email, password) => {
    try {
      const res = await authSignup(username, email, password)
      const u = { ...res.user, id: res.user?.id, demo: false }
      applySession(u, res.token || null)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message || 'Unable to create account.' }
    }
  }, [])

  const logout = useCallback(async () => {
    // Clear the local session first — never block the UI on the network.
    const t = token
    setUser(null)
    setToken(null)
    clearPageSessionData()
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      /* ignore */
    }
    if (t) {
      try {
        await authLogout(t)
      } catch (e) {
        /* ignore */
      }
    }
  }, [token])

  const value = { user, token, ready, login, signup, logout }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}