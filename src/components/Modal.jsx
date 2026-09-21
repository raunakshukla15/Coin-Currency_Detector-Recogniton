import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, children, title, width = 640, center = true }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="glass-card anim-zoom-in"
        style={{
          width: '100%',
          maxWidth: width,
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: 'clamp(20px, 3vw, 36px)'
        }}
      >
        {(title || onClose) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            {title && (
              <h3 style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>
                {title}
              </h3>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="btn btn-ghost btn-sm"
              style={{ padding: 8, borderRadius: 10 }}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}