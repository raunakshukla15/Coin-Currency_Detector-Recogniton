import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BadgeCheck, Globe, Coins as CoinsIcon, Calendar, Layers,
  Scale, Ruler, Landmark, TrendingUp, Gem, Share2, ScanSearch, Plus, Trash2
} from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import GlassCard from '../components/GlassCard.jsx'
import Button from '../components/Button.jsx'
import CoinImage from '../components/CoinImage.jsx'
import Chart from '../components/Chart.jsx'
import PageLayout from '../components/PageLayout.jsx'
import { coins, getCoin } from '../data/coins.js'
import { currencies, ratesToINR } from '../data/currencies.js'
import { useCollection } from '../context/CollectionContext.jsx'
import { rarityFromYear } from '../data/rarity.js'

const ICONS = {
  Country: Globe,
  Denomination: CoinsIcon,
  Year: Calendar,
  Composition: Layers,
  Weight: Scale,
  Diameter: Ruler,
  Obverse: Landmark,
  'Estimated Value': TrendingUp,
  Rarity: Gem
}

const CURRENCY_ICONS = {
  Country: Globe,
  Denomination: CoinsIcon,
  'Currency Name': Layers,
  Series: Landmark,
  Year: Calendar,
  Front: Ruler,
  Back: Scale,
  'Estimated Value': TrendingUp,
  Rarity: Gem
}

const CURRENCY_FIELDS = ['Country', 'Denomination', 'Currency Name', 'Series', 'Year', 'Front', 'Back', 'Estimated Value', 'Rarity']

const CURRENCY_DEFAULTS = {
  name: 'Currency Note',
  country: 'Unknown',
  currencyName: 'Unknown',
  denomination: 'Unknown',
  series: 'Unknown Series',
  year: '',
  front: 'Unable to read',
  back: 'Unable to read',
  description: 'A paper currency note identified by the AI.',
  rarity: 'Common',
  estimatedValue: '$1 – $10',
  match: 0
}

const trendData = [
  { date: 'Mar', value: 22 },
  { date: 'Apr', value: 26 },
  { date: 'May', value: 24 },
  { date: 'Jun', value: 31 },
  { date: 'Jul', value: 38 },
  { date: 'Aug', value: 34 },
  { date: 'Sep', value: 46 },
  { date: 'Oct', value: 58 },
  { date: 'Nov', value: 74 },
  { date: 'Dec', value: 96 },
  { date: 'Jan', value: 128 },
  { date: 'Feb', value: 150 }
]

const TYPE_DEFAULTS = {
  rupee10: { denomination: '10 Rupees (₹10)', composition: 'Bimetallic\n(Cu-Ni center, Al-Bronze ring)', weight: '7.71 grams', diameter: '27 mm', obverse: 'Ashoka Lion Capital\n(Satyameva Jayate)', reverse: '₹10 with decorative rays', description: 'A bimetallic Indian ₹10 circulation coin featuring the Lion Capital obverse and a clean denominational reverse.' },
  rupee1: { denomination: '5 Rupees (₹5)', composition: 'Cupro-Nickel', weight: '6.6 grams', diameter: '23 mm', obverse: 'Ashoka Lion Capital', reverse: 'Denomination & date', description: 'A modern Indian coin from the circulation series, widely used and collected by theme.' },
  eic: { denomination: '1 Rupee', composition: 'Silver', weight: '11.66 grams', diameter: '30 mm', obverse: 'Bust of the monarch', reverse: 'Company marks & wreath', description: 'An East India Company silver rupee of the 19th century with classic colonial-era design.' },
  tetradrachm: { denomination: 'Tetradrachm', composition: 'Silver', weight: '17.2 grams', diameter: '24 mm', obverse: 'Helmeted head of Athena', reverse: 'Owl of Athens', description: 'A classical Greek silver tetradrachm of Athens, among the most iconic coins of antiquity.' },
  morgan: { denomination: '1 Dollar', composition: 'Silver (90%)', weight: '26.73 grams', diameter: '38.1 mm', obverse: 'Liberty profile', reverse: 'Heraldic eagle', description: 'The celebrated Morgan Dollar, struck across US mints from 1878 to 1921.' },
  drape: { denomination: '1 Dollar', composition: 'Silver', weight: '26.96 grams', diameter: '39.5 mm', obverse: 'Draped bust of Liberty', reverse: 'Heraldic eagle', description: 'An early American silver dollar of the Draped Bust design, prized by collectors.' },
  anna: { denomination: '1 Anna', composition: 'Gold/Silver', weight: '8.0 grams', diameter: '25 mm', obverse: 'King Edward VII', reverse: 'Crown & denomination', description: 'A British India anna bearing the portrait of King Edward VII.' },
  sestertius: { denomination: 'Sestertius', composition: 'Bronze', weight: '24 grams', diameter: '31 mm', obverse: 'Imperial portrait', reverse: 'S C within wreath', description: 'A Roman Imperial bronze sestertius, a staple of imperial propaganda coinage.' },
  commem: { denomination: '1 Rupee', composition: 'Silver', weight: '12.0 grams', diameter: '28 mm', obverse: 'National emblem', reverse: 'Commemorative motif', description: 'A commemorative issue marking a historic event, minted in limited quantities.' },
  kushan: { denomination: 'Gold Dinar', composition: 'Gold', weight: '7.9 grams', diameter: '19 mm', obverse: 'Ruler portrait', reverse: 'Deity & legend', description: 'A Kushan empire gold dinar representing one of history\'s great bullion coinages.' }
}

function parseValueRange(coin) {
  const raw = coin.estimatedValue || coin.valueRange
  if (Array.isArray(raw)) return raw
  const m = String(raw || '').match(/[\d,.]+/g)
  if (m && m.length >= 2) {
    const low = parseFloat(m[0].replace(/,/g, ''))
    const high = parseFloat(m[m.length - 1].replace(/,/g, ''))
    if (!isNaN(low)) {
      const lo = Math.round(low * 84)
      const hi = Math.round((!isNaN(high) && high >= low ? high : low * 1.5) * 84)
      return [lo, hi]
    }
  }
  return [
    Math.max(50, Math.round((coin.price || 150) * 0.25)),
    Math.max(200, Math.round((coin.price || 150) * 2))
  ]
}

function enrichCoin(coin) {
  if (!coin || Array.isArray(coin)) coin = {}
  const d = TYPE_DEFAULTS[coin.type] || TYPE_DEFAULTS.rupee10
  const valueRange = parseValueRange(coin)
  return {
    ...coin,
    kind: 'coin',
    type: coin.type || 'rupee10',
    name: coin.name || 'Unknown Coin',
    country: coin.country || 'Unknown',
    year: coin.year || '',
    match: typeof coin.match === 'number' ? coin.match : 86,
    rarity: rarityFromYear(coin.year),
    denomination: coin.denomination || d.denomination,
    composition: coin.composition || d.composition,
    weight: coin.weight || d.weight,
    diameter: coin.diameter || d.diameter,
    obverse: coin.obverse || d.obverse,
    reverse: coin.reverse || d.reverse,
    description: coin.description || d.description,
    valueRange
  }
}

function enrichCurrency(note) {
  if (!note || Array.isArray(note)) note = {}
  const d = CURRENCY_DEFAULTS
  const valueRange = parseValueRange(note)
  return {
    ...note,
    kind: 'currency',
    name: note.name || d.name,
    country: note.country || d.country,
    currencyName: note.currencyName || d.currencyName,
    denomination: note.denomination || d.denomination,
    series: note.series || d.series,
    year: note.year || d.year,
    front: note.front || d.front,
    back: note.back || d.back,
    description: note.description || d.description,
    rarity: rarityFromYear(note.year),
    estimatedValue: note.estimatedValue || d.estimatedValue,
    match: typeof note.match === 'number' ? note.match : d.match,
    confidence: (note.confidence || 'low').toLowerCase(),
    valueRange
  }
}

function enrichItem(item) {
  return (item && item.kind === 'currency') ? enrichCurrency(item) : enrichCoin(item)
}

function formatValue(code, inrValue) {
  const v = inrValue * (ratesToINR[code] ?? 0)
  if (v >= 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  if (v >= 10) return v.toLocaleString('en-IN', { maximumFractionDigits: 1 })
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function formatCoinName(name) {
  const openIdx = String(name || '').indexOf('(')
  const base = openIdx === -1 ? (name || 'Unknown Coin') : name.slice(0, openIdx).trim()
  const paren = openIdx === -1 ? '' : name.slice(openIdx)
  return { base, paren }
}

export default function IdentificationResult() {
  const nav = useNavigate()
  const { addCoin, collection, removeCoin } = useCollection()

  const ident = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('coinscan_lastident')
      return raw ? JSON.parse(raw) : null
    } catch (e) {
      return null
    }
  }, [])

  const [toast, setToast] = useState('')

  const coinsArr = useMemo(() => {
    if (ident?.items?.length) return ident.items.map(enrichItem)
    if (ident?.item) return [enrichItem(ident.item)]
    if (ident?.coins?.length) return ident.coins.map(enrichItem)
    const single = ident?.coin ? enrichItem(ident.coin) : enrichCoin(getCoin(ident?.coinId) || coins[0])
    return [single]
  }, [ident])

  const image = ident?.image || null
  const multiple = coinsArr.length > 1
  const coinCount = coinsArr.filter((i) => i.kind !== 'currency').length
  const noteCount = coinsArr.length - coinCount

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 2600)
      return () => clearTimeout(t)
    }
  }, [toast])

  const showToast = (m) => {
    setToast('')
    setTimeout(() => setToast(m), 30)
  }

  const share = async (coin) => {
    const payload = {
      title: 'CoinScan — Identified Coin',
      text: `${coin.name} (${coin.country}) · ${coin.match}% match via CoinScan`,
      url: window.location.href
    }
    if (navigator.share) {
      try {
        await navigator.share(payload)
        return
      } catch (e) {
        /* user cancelled */
        return
      }
    }
    try {
      await navigator.clipboard.writeText(`${payload.title}\n${payload.text}`)
      showToast('Result link copied to clipboard')
    } catch (e) {
      showToast('Unable to share in this browser')
    }
  }

  return (
    <PageLayout>
      <div
        style={{
          height: 'calc(100vh - 124px)',
          minHeight: 620,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          overflowY: 'auto',
          paddingRight: 5
        }}
      >
        <PageHeader
          compact
          eyebrow="Identification Result"
          title={
            multiple
              ? coinCount > 0 && noteCount > 0
                ? <><span>{coinCount} Coins & {noteCount} Notes </span><span className="teal">Identified</span></>
                : noteCount > 0
                  ? <><span>{coinsArr.length} Notes </span><span className="teal">Identified</span></>
                  : <><span>{coinsArr.length} Coins </span><span className="teal">Identified</span></>
              : coinCount === 0
                ? <><span>Currency Note </span><span className="teal">Identified</span></>
                : <><span>Coin </span><span className="teal">Identified</span></>
          }
          subtitle={multiple
            ? 'Each coin and currency note in your photo is detailed below. Verify the information and explore more.'
            : 'Here are the details about your item. Verify the information and explore more.'}
        />

        {multiple && (
          <div
            className="glass-card-soft"
            style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}
          >
            <BadgeCheck size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            The AI detected <strong style={{ color: 'var(--accent)', margin: '0 4px' }}>{coinsArr.length} items</strong> in this photo ({coinCount} coin{coinCount === 1 ? '' : 's'}{noteCount ? `, ${noteCount} note${noteCount === 1 ? '' : 's'}` : ''}) — showing each one below.
          </div>
        )}

        {coinsArr.map((coin, idx) => {
          const uid = coin.id || `ident-${idx}-${coin.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
          const isCurrency = coin.kind === 'currency'
          const kindLabel = isCurrency ? 'Note' : 'Coin'
          return (
          <div key={`${coin.name}-${idx}`} className="result-main" style={{ gap: 12, alignItems: 'stretch' }}>
            {/* LEFT — item image + all information + graph + currency values */}
            <GlassCard
              className="glass-interior anim-fade-up"
              style={{ padding: 'clamp(14px, 1.6vw, 20px)', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}
            >
              {multiple && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="badge badge-success">{kindLabel} {idx + 1} of {coinsArr.length}</span>
                  {coin.confidence && (
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'capitalize' }}>
                      confidence: {coin.confidence}
                    </span>
                  )}
                </div>
              )}

              {/* header — compact coin image + basic info */}
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div
                  style={{
                    position: 'relative',
                    flexShrink: 0,
                    width: 150,
                    height: 150,
                    borderRadius: 16,
                    overflow: 'hidden',
                    border: '1px solid var(--border-faint)',
                    background:
                      'radial-gradient(120% 100% at 50% 0%, rgba(0,229,195,0.1), transparent 55%), radial-gradient(100% 100% at 18% 82%, rgba(0,169,143,0.08), transparent 50%), #03110e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {image ? (
                    <img
                      src={image}
                      alt={`Detected ${kindLabel.toLowerCase()}`}
                      style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8, borderRadius: 16, display: 'block' }}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                      {isCurrency ? (
                        <img src={coin.imageUrl} alt={coin.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 12, borderRadius: 16, display: 'block' }} />
                      ) : (
                        <CoinImage coin={coin} size={144} glow />
                      )}
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <span className="eyebrow" style={{ letterSpacing: '0.3em', fontSize: 10 }}>{coin.country.toUpperCase()}</span>
                      <h2 style={{ fontSize: 'clamp(18px, 1.9vw, 24px)', fontWeight: 800, letterSpacing: '-0.02em', margin: '6px 0 4px' }}>
                        {(() => {
                          const { base, paren } = formatCoinName(coin.name)
                          return (
                            <>
                              {base}
                              {paren ? <span className="teal"> {paren}</span> : null}
                            </>
                          )
                        })()}
                      </h2>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {(isCurrency ? coin.currencyName || coin.series : coin.composition || 'Bimetallic Coin').split('\n')[0]} • {coin.year}
                      </div>
                      <span className="badge badge-success" style={{ marginTop: 8 }}>
                        <BadgeCheck size={11} strokeWidth={2.6} /> AI Identified · {coin.match}% Match
                      </span>
                    </div>
                  </div>
                  <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
                    {coin.description}
                  </p>
                </div>
              </div>

              {/* all information */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                {(isCurrency ? CURRENCY_FIELDS : ['Country', 'Denomination', 'Year', 'Composition', 'Weight', 'Diameter', 'Obverse', 'Estimated Value', 'Rarity']).map((key) => {
                  const Icon = isCurrency ? CURRENCY_ICONS[key] : ICONS[key]
                  const label =
                    key === 'Country' ? coin.country :
                    key === 'Denomination' ? coin.denomination :
                    key === 'Currency Name' ? coin.currencyName :
                    key === 'Series' ? coin.series :
                    key === 'Year' ? coin.year :
                    key === 'Composition' ? coin.composition :
                    key === 'Weight' ? coin.weight :
                    key === 'Diameter' ? coin.diameter :
                    key === 'Obverse' ? coin.obverse :
                    key === 'Front' ? coin.front :
                    key === 'Back' ? coin.back :
                    key === 'Estimated Value' ? `₹${coin.valueRange?.[0] ?? 0} – ₹${coin.valueRange?.[1] ?? 0}` :
                    coin.rarity || 'Common'
                  return (
                    <div
                      key={key}
                      className="glass-card-soft"
                      style={{ padding: '9px 10px', display: 'flex', gap: 9, alignItems: 'flex-start', minWidth: 0 }}
                    >
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0,229,195,0.08)',
                          border: '1px solid var(--border-faint)',
                          color: 'var(--accent)'
                        }}
                      >
                        <Icon size={13} />
                      </span>
                      <div style={{ minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{key}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: key === 'Estimated Value' ? 'var(--accent)' : 'var(--text-secondary)', lineHeight: 1.3, marginTop: 2, whiteSpace: 'pre-line' }}>
                          {label}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* graph */}
              <div style={{ paddingTop: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span className="eyebrow" style={{ fontSize: 10 }}>Market Insights</span>
                </div>
                <div className="chart-fill" style={{ width: '100%', aspectRatio: '720 / 260', minHeight: 110, overflow: 'hidden' }}>
                  <Chart data={trendData} endLabel={`₹${coin.valueRange?.[1] ?? 150}`} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--accent)', fontWeight: 600, marginTop: 4 }}>
                  <TrendingUp size={14} /> +38% 12-month appreciation
                </div>
              </div>
            </GlassCard>

            {/* RIGHT — actions */}
            <GlassCard
              className="glass-interior anim-fade-up anim-delay-1"
              style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}
            >
              {multiple && (
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2 }}>
                  {coin.name} · Actions
                </span>
              )}
              <span className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>Actions</span>
              <Button
                variant="primary"
                size="md"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  if (collection.some((c) => c.id === uid)) {
                    showToast(`This ${isCurrency ? 'note' : 'coin'} is already in your collection`)
                  } else {
                    addCoin({ ...coin, id: uid, image })
                    showToast(`Added ${coin.name} · ${coin.country} to your collection`)
                  }
                }}
              >
                <Plus size={16} /> {collection.some((c) => c.id === uid) ? 'In Collection' : 'Add to Collection'}
              </Button>
              {collection.some((c) => c.id === uid) && (
                <Button
                  variant="danger"
                  size="md"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => {
                    removeCoin(uid)
                    showToast(`Removed ${coin.name} · ${coin.country} from your collection`)
                  }}
                >
                  <Trash2 size={15} /> Remove from Collection
                </Button>
              )}
              <Button variant="ghost" size="md" style={{ width: '100%', justifyContent: 'center' }} onClick={() => share(coin)}>
                <Share2 size={15} /> Share Result
              </Button>
              {!multiple && (
                <Button variant="ghost" size="md" style={{ width: '100%', justifyContent: 'center' }} onClick={() => nav('/home')}>
                  <ScanSearch size={15} /> New Scan
                </Button>
              )}

              <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--border-faint)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>
                  {isCurrency ? 'Note' : 'Coin'} value in {['INR', 'USD', 'JPY', 'CNY', 'EUR', 'GBP', 'AED', 'SGD', 'HKD', 'AUD', 'CAD', 'CHF', 'KRW', 'THB', 'SAR'].length} currencies
                </div>
                {['INR', 'USD', 'JPY', 'CNY', 'EUR', 'GBP', 'AED', 'SGD', 'HKD', 'AUD', 'CAD', 'CHF', 'KRW', 'THB', 'SAR'].map((code) => {
                  const c = currencies[code]
                  const val = (coin.valueRange?.[1] ?? 150) * (ratesToINR[code] ?? 0)
                  return (
                    <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '2px 0' }}>
                      <span style={{ width: 17, fontSize: 14, flexShrink: 0 }}>{c.flag}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.symbol} {c.code}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: code === 'INR' ? 'var(--accent)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatValue(code, coin.valueRange?.[1] ?? 150)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </GlassCard>
          </div>
          )
        })}

        {multiple && (
          <Button variant="ghost" size="md" onClick={() => nav('/home')} style={{ justifyContent: 'center', alignSelf: 'center', minWidth: 220 }}>
            <ScanSearch size={15} /> New Scan
          </Button>
        )}
      </div>

      {toast && (
        <div
          className="anim-fade-up"
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            background: 'var(--glass-bg-strong)',
            border: '1px solid var(--border-strong)',
            borderRadius: 14,
            padding: '12px 22px',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--accent)',
            backdropFilter: 'blur(14px)',
            boxShadow: 'var(--glow), var(--shadow-deep)'
          }}
        >
          {toast}
        </div>
      )}
    </PageLayout>
  )
}