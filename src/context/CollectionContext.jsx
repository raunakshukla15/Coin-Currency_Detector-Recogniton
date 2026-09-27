import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { rarityFromYear } from '../data/rarity.js'
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

  // Load the logged-in user's collection from the server (MySQL).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (isAuthenticated()) {
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
        }
      } catch (e) {
        console.warn('Unable to load collection:', e?.message || e)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
    if (already) return
    setCollection((prev) => (prev.some((c) => c.id === coin.id) ? prev : [entry, ...prev]))
    if (isAuthenticated()) {
      const { image, imageId, ...item } = entry
      addCollectionItem(coin.id, item, image || null).catch((e) => {
        console.warn('Collection item could not be saved:', e?.message || e)
      })
    }
  }, [collection])

  const removeCoin = useCallback((id) => {
    setCollection((prev) => prev.filter((c) => c.id !== id))
    if (isAuthenticated()) {
      removeCollectionItem(id).catch((e) => {
        console.warn('Collection item could not be removed:', e?.message || e)
      })
    }
  }, [])

  const toggleFavorite = useCallback((id) => {
    let nextValue = false
    setCollection((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c
        nextValue = !c.favorite
        return { ...c, favorite: nextValue }
      })
    )
    if (isAuthenticated()) {
      setCollectionFavorite(id, nextValue).catch((e) => {
        console.warn('Favorite could not be saved:', e?.message || e)
      })
    }
  }, [])

  const resetCollection = useCallback(() => {
    setCollection([])
    if (isAuthenticated()) {
      clearCollectionItems().catch((e) => {
        console.warn('Collection could not be cleared:', e?.message || e)
      })
    }
  }, [])

  const value = { collection, ready, addCoin, removeCoin, toggleFavorite, resetCollection }

  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>
}

export function useCollection() {
  const ctx = useContext(CollectionContext)
  if (!ctx) throw new Error('useCollection must be used within CollectionProvider')
  return ctx
}
