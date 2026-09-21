export default function GlassCard({ children, className = '', hover = false, soft = false, ...props }) {
  const base = soft ? 'glass-card-soft' : 'glass-card'
  return (
    <div className={`${base} ${hover ? 'glass-card-hover' : ''} ${className}`} {...props}>
      {children}
    </div>
  )
}