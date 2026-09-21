import { useMemo } from 'react'
import bg from '../bg/bg.png'

export default function BackgroundFX({ intensity = 'auto' }) {
  const particles = useMemo(() => {
    const arr = []
    const rand = (m, M) => m + Math.random() * (M - m)
    for (let i = 0; i < 20; i++) {
      arr.push({
        left: rand(2, 96),
        bottom: rand(2, 96),
        size: rand(1.5, 3.5),
        duration: rand(12, 26),
        delay: rand(0, 14)
      })
    }
    return arr
  }, [])

  const dimClass = intensity === 'max' ? 'bg-tint soft' : 'bg-tint heavy'
  const photoClass = intensity === 'max' ? 'bg-photo bg-photo--hero' : 'bg-photo'

  return (
    <div className="bg-scene" aria-hidden="true">
      <div className={photoClass} style={{ backgroundImage: `url(${bg})` }} />
      <div className={dimClass} />
      {particles.map((p, i) => (
        <span
          key={i}
          className="particle"
          style={{
            left: `${p.left}%`,
            bottom: `${p.bottom}%`,
            width: p.size,
            height: p.size,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`
          }}
        />
      ))}
      <div className="bg-vignette" />
    </div>
  )
}