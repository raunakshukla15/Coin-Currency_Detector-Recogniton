import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Coins as CoinsIcon, IndianRupee, BadgeCheck, Heart, LayoutGrid, List, ArrowDownUp, ScanSearch } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import SearchBar from '../components/SearchBar.jsx'
import CoinCard from '../components/CoinCard.jsx'
import CoinImage from '../components/CoinImage.jsx'
import GlassCard from '../components/GlassCard.jsx'
import Button from '../components/Button.jsx'
import PageLayout from '../components/PageLayout.jsx'
import { useCollection } from '../context/CollectionContext.jsx'
import { RARITY_TIERS } from '../data/rarity.js'

const CATEGORY_ORDER = RARITY_TIERS

const rarityRank = (r) => {
  const s = String(r || '').toLowerCase()
  if (s.includes('very rare')) return 4
  if (s.includes('rare')) return 3
  if (s.includes('uncommon')) return 2
  return 1
}

const SORTS = ['Rarity: High to Low', 'Rarity: Low to High', 'Newest', 'Oldest']

export default function Collection() {
  const nav = useNavigate()
  const { collection, toggleFavorite } = useCollection()
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('Rarity: High to Low')
  const [listMode, setListMode] = useState(false)

  const total = collection.length
  const portValue = collection.reduce((s, c) => s + (c.price || 0), 0)
  const verified = collection.filter((c) => c.status === 'VERIFIED' || c.status === 'GRADED').length
  const favorites = collection.filter((c) => c.favorite).length

  const categories = useMemo(() => {
    const present = [...new Set(collection.map((c) => c.category || 'Common'))]
    const ordered = CATEGORY_ORDER.filter((c) => present.includes(c))
    const others = present.filter((c) => !CATEGORY_ORDER.includes(c)).sort()
    return ['All', ...ordered, ...others]
  }, [collection])

  const counts = useMemo(() => {
    const map = { All: collection.length }
    for (const cat of categories.slice(1)) {
      map[cat] = collection.filter((c) => (c.category || 'Common') === cat).length
    }
    return map
  }, [collection, categories])

  const filtered = useMemo(() => {
    let list = collection
    if (category !== 'All') list = list.filter((c) => (c.category || 'Common') === category)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(
        (c) =>
          String(c.name || '').toLowerCase().includes(q) ||
          String(c.country || '').toLowerCase().includes(q) ||
          String(c.year || '').toLowerCase().includes(q)
      )
    }
    switch (sort) {
      case 'Rarity: High to Low':
        list = [...list].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity))
        break
      case 'Rarity: Low to High':
        list = [...list].sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity))
        break
      case 'Oldest':
        list = [...list].sort((a, b) => String(a.year || '').localeCompare(String(b.year || '')))
        break
      default:
        list = [...list]
    }
    return list
  }, [collection, category, query, sort])

  const openDetails = (coin) => {
    try {
      sessionStorage.setItem('coinscan_lastident', JSON.stringify({ item: coin, image: coin.image || null }))
    } catch (e) {
      /* ignore */
    }
    nav('/result')
  }

  const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`

  return (
    <PageLayout>
      <PageHeader
        eyebrow="My Collection"
        title={<><span>My </span><span className="teal">Collection</span></>}
        subtitle="Track, grade, and manage every verified coin in your personal vault."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }} className="stat-strip anim-fade-up">
        <StatCard icon={CoinsIcon} label="Total Items" value={total} sub={total ? 'Auto-sorted by rarity' : 'Scan to add your first item'} />
        <StatCard icon={IndianRupee} label="Portfolio Value" value={inr(portValue)} trend="+12.4%" sub="" />
        <StatCard icon={BadgeCheck} label="Verified" value={verified} sub={`${total ? Math.round((verified / total) * 100) : 0}% of collection`} />
        <StatCard icon={Heart} label="Favorites" value={favorites} sub="Marked as favorite" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '250px minmax(0,1fr)', gap: 'clamp(16px, 2.2vw, 28px)', marginTop: 'clamp(24px, 3vw, 36px)', alignItems: 'start' }} className="collection-grid">
        {/* Filter panel */}
        <GlassCard className="glass-interior anim-fade-up anim-delay-1" style={{ padding: '18px 16px', position: 'sticky', top: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>Categories</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className="nav-item"
                style={{
                  fontSize: 14,
                  padding: '10px 14px',
                  ...(category === cat
                    ? { background: 'rgba(0,26,21,0.55)', borderColor: 'var(--border-strong)', color: 'var(--accent)', boxShadow: 'var(--glow)' }
                    : {})
                }}
              >
                <span style={{ flex: 1, textAlign: 'left' }}>{cat}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-faint)' }}>{counts[cat] || 0}</span>
              </button>
            ))}
          </div>
          <div className="divider" style={{ margin: '16px 0 14px' }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Your collection is stored locally on this device and protected by your account.
          </div>
        </GlassCard>

        {/* Grid section */}
        <div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
            <SearchBar value={query} onChange={setQuery} placeholder="Search by coin name, country, or year..." />
            <div style={{ position: 'relative' }}>
              <select
                className="input"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                style={{ appearance: 'none', WebkitAppearance: 'none', padding: '11px 38px 11px 16px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 14 }}
              >
                {SORTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <ArrowDownUp size={14} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} />
            </div>
            <div style={{ display: 'flex', border: '1px solid var(--border-soft)', borderRadius: 12, overflow: 'hidden' }}>
              <button
                onClick={() => setListMode(false)}
                aria-label="Grid view"
                style={{
                  padding: '10px 13px', cursor: 'pointer', border: 'none',
                  background: !listMode ? 'rgba(0,229,195,0.12)' : 'transparent',
                  color: !listMode ? 'var(--accent)' : 'var(--text-faint)',
                  boxShadow: !listMode ? 'var(--glow-soft)' : 'none',
                  transition: 'all .25s ease'
                }}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => setListMode(true)}
                aria-label="List view"
                style={{
                  padding: '10px 13px', cursor: 'pointer', border: 'none', borderLeft: '1px solid var(--border-faint)',
                  background: listMode ? 'rgba(0,229,195,0.12)' : 'transparent',
                  color: listMode ? 'var(--accent)' : 'var(--text-faint)',
                  boxShadow: listMode ? 'var(--glow-soft)' : 'none',
                  transition: 'all .25s ease'
                }}
              >
                <List size={16} />
              </button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <GlassCard className="glass-interior" style={{ padding: '60px 20px', textAlign: 'center' }}>
              {total === 0 ? (
                <>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Your collection is empty</div>
                  <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6, maxWidth: 380, margin: '8px auto 0' }}>
                    Coins and currency notes you identify with CoinScan are saved here — sorted automatically by rarity.
                  </div>
                  <div style={{ marginTop: 18 }}>
                    <Button variant="primary" size="md" onClick={() => nav('/home')}>
                      <ScanSearch size={16} /> Identify Your First Coin
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 16, color: 'var(--text-muted)' }}>No coins match your current filters.</div>
                  <button className="link-teal" style={{ marginTop: 10 }} onClick={() => { setQuery(''); setCategory('All'); setSort('Rarity: High to Low') }}>Clear filters</button>
                </>
              )}
            </GlassCard>
          ) : listMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filtered.map((coin) => (
                <GlassCard
                  hover
                  key={coin.id}
                  className="glass-interior"
                  style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 18, cursor: 'pointer', flexWrap: 'wrap' }}
                >
                  <button onClick={() => openDetails(coin)} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                    {coin.image ? (
                      <img src={coin.image} alt={coin.name} style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--border-faint)' }} />
                    ) : (
                      <CoinImage coin={coin} size={76} />
                    )}
                  </button>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{coin.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
                      {coin.country} · {coin.year}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <span className={`badge ${coin.status === 'VERIFIED' ? 'badge-success' : coin.status === 'GRADED' ? 'badge-grade' : 'badge-warn'}`}>
                        {coin.status}
                      </span>
                      {coin.grade && <span className="badge badge-grade">{coin.grade}</span>}
                    </div>
                  </div>
                  <div style={{ width: 150, textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)' }}>{inr(coin.price)}</div>
                    <button
                      onClick={() => toggleFavorite(coin.id)}
                      aria-label="Toggle favorite"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', marginTop: 6,
                        color: coin.favorite ? '#ff7d9c' : 'var(--text-faint)',
                        filter: coin.favorite ? 'drop-shadow(0 0 6px rgba(255,125,156,0.6))' : 'none'
                      }}
                    >
                      <Heart size={17} fill={coin.favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => openDetails(coin)}>View Details</button>
                </GlassCard>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 16 }} className="coin-grid">
              {filtered.map((coin) => (
                <CoinCard key={coin.id} coin={coin} isFavorite={coin.favorite} onFavorite={toggleFavorite} onView={openDetails} />
              ))}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  )
}