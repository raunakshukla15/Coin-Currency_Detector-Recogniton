import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BadgeCheck, Globe, Coins as CoinsIcon, Calendar, Layers,
  Scale, Ruler, Landmark, TrendingUp, Gem, Share2, ScanSearch, Plus, Trash2,
  ShieldQuestion, ShieldAlert
} from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import GlassCard from '../components/GlassCard.jsx'
import Button from '../components/Button.jsx'
import CoinImage from '../components/CoinImage.jsx'
import Chart from '../components/Chart.jsx'
import PageLayout from '../components/PageLayout.jsx'
import { getCoin } from '../data/coins.js'
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

// Neutral placeholder for fields the AI did NOT provide — we never invent
// specs (weight/composition/etc.) or confidence for an uploaded image.
const NEUTRAL = '—'

const NEUTRAL_COIN_SPEC = {
  denomination: NEUTRAL, composition: NEUTRAL, weight: NEUTRAL,
  diameter: NEUTRAL, obverse: NEUTRAL, reverse: NEUTRAL, description: ''
}

const CURRENCY_DEFAULTS = {
  name: 'Identified Note',
  country: 'Unknown',
  currencyName: NEUTRAL,
  denomination: NEUTRAL,
  series: NEUTRAL,
  year: '',
  front: NEUTRAL,
  back: NEUTRAL,
  description: '',
  rarity: 'Common',
  estimatedValue: null,
  match: null
}

// Static sample series used ONLY for the decorative illustrative chart.
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
  if (Array.isArray(raw) && raw.length) return raw
  if (raw != null && raw !== '') {
    const m = String(raw).match(/[\d,.]+/g)
    if (m && m.length >= 2) {
      const low = parseFloat(m[0].replace(/,/g, ''))
      const high = parseFloat(m[m.length - 1].replace(/,/g, ''))
      if (!isNaN(low)) {
        const lo = Math.round(low * 84)
        const hi = Math.round((!isNaN(high) && high >= low ? high : low * 1.5) * 84)
        return [lo, hi]
      }
    }
  }
  // Derived range from a reference price (local catalog items only).
  if (typeof coin.price === 'number' && coin.price > 0) {
    return [
      Math.max(50, Math.round(coin.price * 0.25)),
      Math.max(200, Math.round(coin.price * 2))
    ]
  }
  // No data -> null (never fabricate a value range for an uploaded image).
  return null
}

function enrichCoin(coin, { catalog = false } = {}) {
  if (!coin || Array.isArray(coin)) coin = {}
  const d = catalog ? (TYPE_DEFAULTS[coin.type] || TYPE_DEFAULTS.rupee10) : NEUTRAL_COIN_SPEC
  const valueRange = parseValueRange(coin)
  return {
    ...coin,
    kind: 'coin',
    name: coin.name || 'Identified Coin',
    country: coin.country || 'Unknown',
    year: coin.year || '',
    match: typeof coin.match === 'number' ? coin.match : null,
    rarity: coin.rarity || rarityFromYear(coin.year),
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
    rarity: note.rarity || rarityFromYear(note.year),
    estimatedValue: note.estimatedValue || d.estimatedValue,
    match: typeof note.match === 'number' ? note.match : null,
    confidence: (note.confidence || '').toLowerCase() || null,
    valueRange
  }
}

function enrichItem(item, opts) {
  return (item && item.kind === 'currency') ? enrichCurrency(item) : enrichCoin(item, opts)
}

// The four supported authenticity assessments, shown with the app's three
// required user-facing wordings: positive -> "No obvious suspicious signs
// detected" (never a genuineness claim), SUSPICIOUS and LIKELY_COUNTERFEIT
// -> "Potentially suspicious", UNABLE/legacy VERIFIED -> "Inconclusive".
// Recognition confidence (match %) is ALWAYS separate — it only means "the
// AI recognized WHAT this is", never "this % genuine".
const AUTH_META = {
  LIKELY_COUNTERFEIT: { label: 'Potentially suspicious', cls: 'badge-danger', Icon: ShieldAlert, tone: 'danger' },
  SUSPICIOUS: { label: 'Potentially suspicious', cls: 'badge-warn', Icon: ShieldAlert, tone: 'warn' },
  LIKELY_GENUINE: { label: 'No obvious suspicious signs detected', cls: 'badge-success', Icon: BadgeCheck, tone: 'ok' },
  UNABLE_TO_VERIFY: { label: 'Inconclusive', cls: 'badge-neutral', Icon: ShieldQuestion, tone: 'neutral' },
  VERIFIED_AUTHENTIC: { label: 'Inconclusive', cls: 'badge-neutral', Icon: ShieldQuestion, tone: 'neutral' }
}

// Fixed limitations / next-step texts for legacy stored rows that predate
// the backend fields (wording mirrors backend ai.py _auth_extras()).
const AUTH_LIMITATIONS_FALLBACK =
  'Preliminary visual assessment from the uploaded photo only. A photograph ' +
  'cannot verify metal composition, exact weight, magnetic properties, ' +
  'diameter/tolerance, or any other physical characteristic that has not ' +
  'been measured, and it does not confirm that the item is genuine.'
const AUTH_NEXT_STEPS_FALLBACK = {
  UNABLE: 'Image quality, missing views, or a compromised photo prevented a meaningful assessment. Please upload clear, well-lit photographs of BOTH faces and of the edge (where practical), without added text or annotations, and scan again.',
  SUSPICIOUS: 'Visible differences were detected. Examine both faces and the edge, compare with a trusted reference, and have the item physically verified by a qualified authority (dealer, grading service, or museum) before relying on it.',
  GENUINE: 'No obvious suspicious signs were seen in this photo, which does NOT confirm authenticity. If authenticity matters, have the item physically verified by a qualified authority.'
}

function authMeta(status) {
  return AUTH_META[status] || AUTH_META.UNABLE_TO_VERIFY
}

function authenticityFor(item, overall) {
  // Only surface an assessment when image analysis actually produced one.
  // No uploaded-image analysis => do not invent a status.
  const status = item?.authenticity_status || overall?.status || null
  if (!status) return null
  const meta = authMeta(status)
  const bucket =
    status === 'LIKELY_GENUINE'
      ? 'GENUINE'
      : status === 'UNABLE_TO_VERIFY' || status === 'VERIFIED_AUTHENTIC'
        ? 'UNABLE'
        : 'SUSPICIOUS'
  const indicators = (item?.suspiciousIndicators || overall?.indicators || []).filter(Boolean)
  return {
    status,
    label: item?.authenticity_label || overall?.label || meta.label,
    message:
      item?.authenticity_message ||
      overall?.message ||
      'Authenticity cannot be determined from this image.',
    indicators,
    limitations: item?.authenticity_limitations || overall?.limitations || AUTH_LIMITATIONS_FALLBACK,
    nextSteps:
      item?.authenticity_next_steps || overall?.next_steps || AUTH_NEXT_STEPS_FALLBACK[bucket]
  }
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
  const { addCoin, collection, removeCoin, saveError } = useCollection()

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
    // ident.items / ident.item / ident.coins come from the uploaded-image AI
    // analysis (or saved results) — missing fields stay neutral, never
    // invented. ident.coinId is a local catalog reference lookup (static
    // reference data), which may use the bundled reference defaults.
    if (ident?.items?.length) return ident.items.map((i) => enrichItem(i))
    if (ident?.item) return [enrichItem(ident.item)]
    if (ident?.coins?.length) return ident.coins.map((i) => enrichItem(i))
    if (ident?.coin) return [enrichItem(ident.coin)]
    if (ident?.coinId) {
      const found = getCoin(ident.coinId)
      return found ? [enrichCoin(found, { catalog: true })] : []
    }
    return []
  }, [ident])

  const image = ident?.image || null
  const overallAuth = ident?.authenticity || null
  const multiple = coinsArr.length > 1
  const coinCount = coinsArr.filter((i) => i.kind !== 'currency').length
  const noteCount = coinsArr.length - coinCount
  const hasData = coinsArr.length > 0

  useEffect(() => {
    // Direct visit with no identification in session — nothing to show.
    if (!hasData) nav('/home', { replace: true })
  }, [hasData, nav])

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

  useEffect(() => {
    // A failed collection save replaces the optimistic "Added…" toast with
    // the honest error (the failed item itself was rolled back in the
    // context, so the button flips back to "Add to Collection" and a retry
    // is possible).
    if (saveError) showToast(saveError)
  }, [saveError])

  const share = async (coin) => {
    const payload = {
      title: 'CoinScan — Identified Coin',
      text: coin.match != null
        ? `${coin.name} (${coin.country}) · ${coin.match}% match via CoinScan`
        : `${coin.name} (${coin.country}) · identified via CoinScan`,
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

  if (!hasData) return null

  return (
    <PageLayout>
      <div
        className="result-scroll"
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
          const auth = authenticityFor(coin, overallAuth)
          const meta = auth ? authMeta(auth.status) : null
          const authWarn = meta && (meta.tone === 'danger' || meta.tone === 'warn')
          const authIconColor = meta ? (meta.tone === 'danger' ? '#f5717a' : meta.tone === 'warn' ? '#f5b450' : 'var(--accent)') : 'var(--accent)'
          const AuthIcon = meta ? meta.Icon : null
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
              <div className="result-head" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
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
                        {(isCurrency ? (coin.currencyName !== NEUTRAL ? coin.currencyName : coin.series) : coin.composition).split('\n')[0]}
                        {coin.year ? ` • ${coin.year}` : ''}
                      </div>
                      {coin.match != null ? (
                        <span className="badge badge-success" style={{ marginTop: 8 }}>
                          <BadgeCheck size={11} strokeWidth={2.6} /> AI Identified · {coin.match}% Match
                        </span>
                      ) : (
                        <span className="badge badge-success" style={{ marginTop: 8 }}>
                          <BadgeCheck size={11} strokeWidth={2.6} /> AI Identified
                        </span>
                      )}
                      {coin.match != null && (
                        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 4 }}>
                          {coin.match}% is recognition confidence (what the AI thinks this is) — not proof of genuineness.
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Authenticity: only when image analysis produced a status */}
                  {auth && meta && AuthIcon && (
                  <div
                    className="glass-card-soft"
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      borderRadius: 12,
                      display: 'flex',
                      gap: 9,
                      alignItems: 'flex-start',
                      border:
                        meta.tone === 'danger'
                          ? '1px solid rgba(245,113,122,0.55)'
                          : authWarn
                            ? '1px solid rgba(245,180,80,0.45)'
                            : '1px solid var(--border-faint)',
                      background:
                        meta.tone === 'danger'
                          ? 'rgba(245,113,122,0.06)'
                          : undefined
                    }}
                  >
                    <AuthIcon size={15} style={{ color: authIconColor, flexShrink: 0, marginTop: 1 }} />
                    <div style={{ minWidth: 0 }}>
                      <span
                        className={`badge ${meta.cls}`}
                        style={{ marginBottom: 4, display: 'inline-flex' }}
                      >
                        Authenticity: {auth.label}
                      </span>
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: 4 }}>
                        {auth.message}
                      </div>
                      {auth.indicators.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                          <div style={{ fontWeight: 700 }}>Visible warning signs</div>
                          <ul style={{ margin: '3px 0 0', paddingLeft: 16 }}>
                            {auth.indicators.slice(0, 6).map((ind, i) => (
                              <li key={i} style={{ lineHeight: 1.5 }}>{ind}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.5, marginTop: 6 }}>
                        {auth.limitations}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 4 }}>
                        <strong style={{ fontWeight: 700 }}>Next steps:</strong> {auth.nextSteps}
                      </div>
                    </div>
                  </div>
                  )}
                  {coin.description ? (
                    <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
                      {coin.description}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* all information */}
              <div className="result-facts" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
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
                    key === 'Estimated Value' ? (coin.valueRange ? `₹${coin.valueRange[0]} – ₹${coin.valueRange[1]}` : NEUTRAL) :
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

              {/* graph — decorative sample, clearly labelled (not live data) */}
              <div style={{ paddingTop: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span className="eyebrow" style={{ fontSize: 10 }}>Market Insights · Illustrative</span>
                </div>
                <div className="chart-fill" style={{ width: '100%', aspectRatio: '720 / 260', minHeight: 110, overflow: 'hidden' }}>
                  <Chart data={trendData} endLabel={coin.valueRange ? `₹${coin.valueRange[1]}` : null} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 4 }}>
                  <TrendingUp size={14} style={{ color: 'var(--accent)' }} /> Sample trend data — not live market prices
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
                  const base = coin.valueRange ? coin.valueRange[1] : null
                  return (
                    <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '2px 0' }}>
                      <span style={{ width: 17, fontSize: 14, flexShrink: 0 }}>{c.flag}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.symbol} {c.code}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: code === 'INR' ? 'var(--accent)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {base != null ? formatValue(code, base) : NEUTRAL}
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