import { BadgeCheck, Clock, Award } from 'lucide-react'

const variants = {
  VERIFIED: { label: 'VERIFIED', icon: BadgeCheck, cls: 'badge-success' },
  GRADED: { label: 'GRADED', icon: Award, cls: 'badge-grade' },
  PENDING: { label: 'PENDING', icon: Clock, cls: 'badge-warn' },
  FAVORITE: { label: 'FAVORITE', icon: Award, cls: 'badge-purple' }
}

export default function StatusBadge({ status, className = '' }) {
  const v = variants[status] || variants.PENDING
  const Icon = v.icon
  return (
    <span className={`badge ${v.cls} ${className}`}>
      <Icon size={11} strokeWidth={2.5} />
      {v.label}
    </span>
  )
}