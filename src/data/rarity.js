export const RARITY_TIERS = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Epic', 'Legendary', 'Mythic', 'Ultra', 'Ancient']

const CURRENT_YEAR = new Date().getFullYear()

export function parseYearNum(yearStr) {
  const s = String(yearStr || '').toLowerCase().trim()
  if (!s) return null
  const m = s.match(/-?\d+/)
  if (!m) return null
  let num = parseInt(m[0], 10)
  if (s.includes('bc')) num = -Math.abs(num)
  return num
}

export function rarityFromYear(yearStr) {
  const yr = parseYearNum(yearStr)
  if (yr === null) return 'Common'
  const age = CURRENT_YEAR - yr
  if (age > 150) return 'Ancient'
  if (age > 100) return 'Ultra'
  if (age > 70) return 'Mythic'
  if (age > 45) return 'Legendary'
  if (age > 30) return 'Epic'
  if (age > 20) return 'Very Rare'
  if (age > 15) return 'Rare'
  if (age > 10) return 'Uncommon'
  return 'Common'
}