import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { rarityFromYear } from '../data/rarity.js'
import { useAuth } from './AuthContext.jsx'
import {
  fetchCollection,
  addCollectionItem,
  removeCollectionItem,
  setCollectionFavorite,
  clearCollectionItems,
  fetchImageDataUrl,
  isAuthenticated
} from '../api.js'

const CollectionContext = createContext(null)

const SEED_IDS = new Set([
  'eic-1835', 'tetradrachm-athens', 'drape-1804', 'rupee10-2010-col',
  'anna-1908', 'commem-1947', 'sestertius-roman', 'rup5-1985'
])

function normalize(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && !SEED_IDS.has(c.id))
    .map((c) => ({ ...c, category: rarityFromYear(c.year) }))
}

export function CollectionProvider({ children }) {
  const [collection, setCollection] = useState([])
  const [ready, setReady] = useState(false)
  const [saveError, setSaveError] = useState('')
  const { user, ready: authReady } = useAuth()

  // Latest account id: late async results use it to know whether they still
  // belong to the account that started them (a response for a previous
  // account must never roll back or flag the current account's data).
  const userRef = useRef(null)
  userRef.current = user?.id

  // Load the logged-in user's collection from the server (MySQL).
  // Re-runs whenever the authenticated account changes (login, logout, or
  // switching accounts WITHOUT a page refresh):
  //   1. the previous account's items are wiped synchronously, so another
  //      user's collection is never on screen while the new one loads;
  //   2. the cancelled flag aborts in-flight responses from the previous
  //      account so a stale response can never overwrite the new state;
  //   3. fetch errors leave the list EMPTY (never stale data).
  useEffect(() => {
    let cancelled = false
    setCollection([])
    setReady(false)
    setSaveError('')
    if (!authReady) {
      return () => {
        cancelled = true
      }
    }
    if (!user) {
      // Logged out: nothing to load, collection stays empty.
      setReady(true)
      return () => {
        cancelled = true
      }
    }
    ;(async () => {
      try {
        const { items } = await fetchCollection()
        const normalized = normalize(items)
        // Resolve per-item uploaded images (owner-only).
        const withImages = await Promise.all(
          normalized.map(async (c) => {
            if (c.imageId && !c.image) {
              const image = await fetchImageDataUrl(c.imageId)
              return { ...c, image: image || null }
            }
            return c
          })
        )
        if (!cancelled) setCollection(withImages)
      } catch (e) {
        console.warn('Unable to load collection:', e?.message || e)
        if (!cancelled) setCollection([])
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id, authReady])

  const addCoin = useCallback((coin) => {
    const already = collection.some((c) => c.id === coin.id)
    const rawPrice = typeof coin.price === 'number' && coin.price > 0
      ? coin.price
      : Array.isArray(coin.valueRange) && coin.valueRange.length
        ? coin.valueRange[coin.valueRange.length - 1] || 0
        : 0
    const entry = {
      ...coin,
      status: 'PENDING',
      category: coin.category || rarityFromYear(coin.year),
      price: rawPrice,
      priceDisplay: rawPrice > 0 ? `₹${Number(rawPrice).toLocaleString('en-IN')}` : '—'
    }
    setSaveError('')
    if (already) return
    const uid = user?.id
    setCollection((prev) => (prev.some((c) => c.id === coin.id) ? prev : [entry, ...prev]))
    if (isAuthenticated()) {
      const { image, imageId, ...item } = entry
      addCollectionItem(coin.id, item, image || null).catch((e) => {
        console.warn('Collection item could not be saved:', e?.message || e)
        // A response belonging to a previous account must never roll back
        // the current account's data or surface an error in its view.
        if (uid !== userRef.current) return
        // Roll back ONLY this optimistic entry — every other item (and the
        // account's existing collection data) stays untouched.
        setCollection((prev) =>
          prev.filter((c) => !(c.id === coin.id && c.status === 'PENDING'))
        )
        setSaveError("Couldn't save this item to your collection. Please try again.")
      })
    }
  }, [collection, user?.id])

  const removeCoin = useCallback((id) => {
    setSaveError('')
    // Snapshot taken BEFORE the optimistic removal so a failed delete puts
    // the item back exactly where it was (same pattern as Chatbot.deleteChat).
    const snapshot = collection
    const uid = user?.id
    setCollection((prev) => prev.filter((c) => c.id !== id))
    if (isAuthenticated()) {
      removeCollectionItem(id).catch((e) => {
        console.warn('Collection item could not be removed:', e?.message || e)
        // A late failure from a previous account must never touch the
        // current account's state or surface an error in its view.
        if (uid !== userRef.current) return
        setCollection((cur) => {
          if (cur.some((c) => c.id === id)) return cur
          const idx = snapshot.findIndex((c) => c.id === id)
          if (idx < 0) return cur
          const next = [...cur]
          next.splice(Math.max(0, Math.min(idx, next.length)), 0, snapshot[idx])
          return next
        })
        setSaveError("Couldn't remove this item from your collection. Please try again.")
      })
    }
  }, [collection, user?.id])

  const toggleFavorite = useCallback((id) => {
    setSaveError('')
    // The next value is derived from the CURRENT state up front — never from
    // inside a setState updater, which React may run later (stale write risk).
    const current = collection.find((c) => c.id === id)
    if (!current) return
    const nextValue = !current.favorite
    const uid = user?.id
    setCollection((prev) =>
      prev.map((c) => (c.id === id ? { ...c, favorite: nextValue } : c))
    )
    if (isAuthenticated()) {
      setCollectionFavorite(id, nextValue).catch((e) => {
        console.warn('Favorite could not be saved:', e?.message || e)
        if (uid !== userRef.current) return
        // Roll back only if this is still the value we optimistically set —
        // a later successful toggle must never be clobbered by this failure.
        setCollection((prev) =>
          prev.map((c) =>
            c.id === id && c.favorite === nextValue
              ? { ...c, favorite: current.favorite }
              : c
          )
        )
        setSaveError("Couldn't update your favorite. Please try again.")
      })
    }
  }, [collection, user?.id])

  const resetCollection = useCallback(() => {
    setSaveError('')
    const snapshot = collection
    const uid = user?.id
    setCollection([])
    if (isAuthenticated()) {
      clearCollectionItems().catch((e) => {
        console.warn('Collection could not be cleared:', e?.message || e)
        if (uid !== userRef.current) return
        // Restore only if the user has not added anything new meanwhile.
        setCollection((cur) => (cur.length ? cur : snapshot))
        setSaveError("Couldn't clear your collection. Please try again.")
      })
    }
  }, [collection, user?.id])

  const value = { collection, ready, saveError, addCoin, removeCoin, toggleFavorite, resetCollection }

  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>
}

export function useCollection() {
  const ctx = useContext(CollectionContext)
  if (!ctx) throw new Error('useCollection must be used within CollectionProvider')
  return ctx
}
