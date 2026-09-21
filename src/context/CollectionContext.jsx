import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { rarityFromYear } from '../data/rarity.js'

const CollectionContext = createContext(null)
const STORAGE_KEY = 'coinscan_collection'

const SEED_IDS = new Set([
  'eic-1835', 'tetradrachm-athens', 'drape-1804', 'rupee10-2010-col',
  'anna-1908', 'commem-1947', 'sestertius-roman', 'rup5-1985'
])

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const items = JSON.parse(raw)
      if (Array.isArray(items)) {
        return items
          .filter((c) => c && !SEED_IDS.has(c.id))
          .map((c) => ({ ...c, category: rarityFromYear(c.year) }))
      }
    }
  } catch (e) {
    /* ignore */
  }
  return []
}

export function CollectionProvider({ children }) {
  const [collection, setCollection] = useState(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collection))
    } catch (e) {
      /* ignore */
    }
  }, [collection])

  const addCoin = useCallback((coin) => {
    setCollection((prev) => {
      if (prev.some((c) => c.id === coin.id)) return prev
      const rawPrice = typeof coin.price === 'number' && coin.price > 0
        ? coin.price
        : Array.isArray(coin.valueRange) && coin.valueRange.length
          ? coin.valueRange[coin.valueRange.length - 1] || 0
          : 0
      return [{
        ...coin,
        status: 'PENDING',
        category: coin.category || rarityFromYear(coin.year),
        price: rawPrice,
        priceDisplay: `₹${Number(rawPrice).toLocaleString('en-IN')}`
      }, ...prev]
    })
  }, [])

  const removeCoin = useCallback((id) => {
    setCollection((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const toggleFavorite = useCallback((id) => {
    setCollection((prev) => prev.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)))
  }, [])

  const resetCollection = useCallback(() => {
    setCollection([])
  }, [])

  const value = { collection, addCoin, removeCoin, toggleFavorite, resetCollection }

  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>
}

export function useCollection() {
  const ctx = useContext(CollectionContext)
  if (!ctx) throw new Error('useCollection must be used within CollectionProvider')
  return ctx
}