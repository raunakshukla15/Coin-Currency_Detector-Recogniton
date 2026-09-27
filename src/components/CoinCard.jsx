import { Heart, ShieldCheck, ArrowRight } from 'lucide-react'
import CoinImage from './CoinImage.jsx'
import StatusBadge from './StatusBadge.jsx'
import GlassCard from './GlassCard.jsx'
import Button from './Button.jsx'

export default function CoinCard({
  coin,
  onView,
  onFavorite,
  onBuy,
  isFavorite = false,
  mode = 'collection',
  style
}) {
  return (
    <GlassCard
      hover
      className="glass-interior coin-hover-scale"
      style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, ...style }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {coin.status ? (
          <StatusBadge status={coin.status} />
        ) : (
          coin.verification && (
            <span className="badge badge-success">
              <ShieldCheck size={11} /> {coin.verification}
            </span>
          )
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {coin.year && (
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
              {coin.year}
            </span>
          )}
          <button
            onClick={() => onFavorite && onFavorite(coin.id)}
            aria-label="Toggle favorite"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              color: isFavorite ? '#ff7d9c' : 'var(--text-faint)',
              filter: isFavorite ? 'drop-shadow(0 0 6px rgba(255,125,156,0.6))' : 'none',
              transition: 'all .25s ease'
            }}
          >
            <Heart size={17} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 2px' }}>
        {coin.image ? (
          <img
            src={coin.image}
            alt={coin.name}
            style={{ width: 150, height: 150, objectFit: 'cover', borderRadius: 18, border: '1px solid var(--border-faint)' }}
          />
        ) : (
          <CoinImage coin={coin} size={150} className="coin-hover-scale" />
        )}
      </div>

      {coin.grade && (
        <div style={{ textAlign: 'center', marginTop: -8 }}>
          <span className="badge badge-grade" style={{ fontSize: 10 }}>
            {coin.grade}
          </span>
        </div>
      )}

      <div>
        <div
          style={{
            fontSize: 15.5,
            fontWeight: 700,
            lineHeight: 1.3,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {coin.name}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {coin.tags?.slice(0, 3).map((t) => (
            <span
              key={t}
              style={{
                padding: '3px 9px',
                borderRadius: 99,
                background: 'rgba(0,229,195,0.07)',
                border: '1px solid var(--border-faint)',
                fontSize: 11,
                color: 'var(--text-secondary)'
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="divider-solid" />

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
            Price
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.01em' }}>
            {coin.priceDisplay || (typeof coin.price === 'number' && coin.price > 0
              ? `₹${Number(coin.price).toLocaleString('en-IN')}`
              : '—')}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        {onView && (
          <Button variant="ghost" size="sm" className="" style={{ flex: 1 }} onClick={() => onView(coin)}>
            View Details <ArrowRight size={14} />
          </Button>
        )}
      </div>
    </GlassCard>
  )
}