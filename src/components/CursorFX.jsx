import { useEffect, useRef, useState } from 'react'

let seq = 0

export default function CursorFX() {
  const lastRef = useRef(0)
  const liveRef = useRef(0)
  const [sparks, setSparks] = useState([])

  useEffect(() => {
    const onMove = (e) => {
      const now = performance.now()
      if (now - lastRef.current < 40) return
      lastRef.current = now
      if (liveRef.current >= 36) return

      const id = ++seq
      liveRef.current += 1
      const teal = Math.random() < 0.72
      const spark = {
        id,
        x: e.clientX,
        y: e.clientY,
        size: 5 + Math.random() * 8,
        rot: Math.random() * 360,
        dx: (Math.random() - 0.5) * 70,
        dy: (Math.random() - 0.5) * 70 - 26,
        color: teal ? '0,229,195' : '245,200,106',
        life: 680 + Math.random() * 520
      }
      setSparks((s) => [...s.slice(-30), spark])

      setTimeout(() => {
        setSparks((s) => s.filter((k) => k.id !== id))
        liveRef.current = Math.max(0, liveRef.current - 1)
      }, spark.life)
    }

    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9998, overflow: 'hidden' }}
    >
      {sparks.map((s) => (
        <span
          key={s.id}
          className="cursor-spark"
          style={{
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            color: `rgba(${s.color}, 1)`,
            '--rot': `${s.rot}deg`,
            '--dx': `${s.dx}px`,
            '--dy': `${s.dy}px`,
            '--life': `${s.life}ms`
          }}
        />
      ))}
    </div>
  )
}