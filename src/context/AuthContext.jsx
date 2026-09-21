import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authLogin, authSignup, authLogout, authMe, isBackendError } from '../api.js'

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

function demoUser(identifier) {
  const at = identifier.indexOf('@')
  const username = at === -1 ? identifier.trim() : identifier.slice(0, at)
  return { username, email: at === -1 ? `${username}@coinscan.io` : identifier, demo: true }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const stored = loadStored()
    if (stored?.token && !stored.demo) {
      authMe(stored.token)
        .then((u) => {
          setUser(u)
          setToken(stored.token)
        })
        .catch(() => {
          // Token expired — drop stored session.
          try {
            localStorage.removeItem(STORAGE_KEY)
          } catch (e) {
            /* ignore */
          }
        })
        .finally(() => setReady(true))
    } else if (stored?.user && stored.demo) {
      setUser(stored.user)
      setToken(null)
      setReady(true)
    } else {
      setReady(true)
    }
  }, [])

  const applySession = (u, t) => {
    setUser(u)
    setToken(t)
    persist({ user: u, token: t, demo: !t })
  }

  const login = useCallback(async (identifier, password) => {
    try {
      const res = await authLogin(identifier, password)
      const u = { ...res.user, id: res.user?.id, demo: false }
      applySession(u, res.token || null)
      return { ok: true }
    } catch (e) {
      // If the backend is unreachable but running locally isn't required
      // (no backend configured), fall back to the offline demo account.
      if (isBackendError(e) && (e.status === undefined)) {
        const u = demoUser(identifier)
        applySession(u, null)
        return { ok: true, demo: true }
      }
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
      if (isBackendError(e) && e.status === undefined) {
        const u = { username, email, demo: true }
        applySession(u, null)
        return { ok: true, demo: true }
      }
      return { ok: false, error: e.message || 'Unable to create account.' }
    }
  }, [])

  const logout = useCallback(async () => {
    if (token) {
      try {
        await authLogout(token)
      } catch (e) {
        /* ignore */
      }
    }
    setUser(null)
    setToken(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      /* ignore */
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