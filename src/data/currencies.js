export const currencies = {
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', country: 'India', flag: '🇮🇳' },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', country: 'United States', flag: '🇺🇸' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', country: 'European Union', flag: '🇪🇺' },
  GBP: { code: 'GBP', symbol: '£', name: 'Pound Sterling', country: 'United Kingdom', flag: '🇬🇧' },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', country: 'Japan', flag: '🇯🇵' },
  CNY: { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', country: 'China', flag: '🇨🇳' },
  AED: { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', country: 'UAE', flag: '🇦🇪' },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', country: 'Singapore', flag: '🇸🇬' },
  HKD: { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', country: 'Hong Kong', flag: '🇭🇰' },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', country: 'Australia', flag: '🇦🇺' },
  CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', country: 'Canada', flag: '🇨🇦' },
  NZD: { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', country: 'New Zealand', flag: '🇳🇿' },
  CHF: { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc', country: 'Switzerland', flag: '🇨🇭' },
  KRW: { code: 'KRW', symbol: '₩', name: 'South Korean Won', country: 'South Korea', flag: '🇰🇷' },
  MYR: { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', country: 'Malaysia', flag: '🇲🇾' },
  IDR: { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', country: 'Indonesia', flag: '🇮🇩' },
  THB: { code: 'THB', symbol: '฿', name: 'Thai Baht', country: 'Thailand', flag: '🇹🇭' },
  PHP: { code: 'PHP', symbol: '₱', name: 'Philippine Peso', country: 'Philippines', flag: '🇵🇭' },
  VND: { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', country: 'Vietnam', flag: '🇻🇳' },
  PKR: { code: 'PKR', symbol: '₨', name: 'Pakistani Rupee', country: 'Pakistan', flag: '🇵🇰' },
  BDT: { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka', country: 'Bangladesh', flag: '🇧🇩' },
  LKR: { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee', country: 'Sri Lanka', flag: '🇱🇰' },
  SAR: { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', country: 'Saudi Arabia', flag: '🇸🇦' },
  ZAR: { code: 'ZAR', symbol: 'R', name: 'South African Rand', country: 'South Africa', flag: '🇿🇦' },
  MXN: { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso', country: 'Mexico', flag: '🇲🇽' },
  BRL: { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', country: 'Brazil', flag: '🇧🇷' },
  TRY: { code: 'TRY', symbol: '₺', name: 'Turkish Lira', country: 'Turkey', flag: '🇹🇷' },
  NOK: { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', country: 'Norway', flag: '🇳🇴' },
  SEK: { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', country: 'Sweden', flag: '🇸🇪' },
  DKK: { code: 'DKK', symbol: 'kr', name: 'Danish Krone', country: 'Denmark', flag: '🇩🇰' },
  PLN: { code: 'PLN', symbol: 'zł', name: 'Polish Złoty', country: 'Poland', flag: '🇵🇱' },
  KWD: { code: 'KWD', symbol: 'د.ك', name: 'Kuwaiti Dinar', country: 'Kuwait', flag: '🇰🇼' }
}

// Base rates expressed as 1 INR = x of the currency (approximate, for display)
export const ratesToINR = {
  INR: 1,
  USD: 0.0117,
  EUR: 0.0091,
  GBP: 0.0078,
  JPY: 1.8,
  CNY: 0.085,
  AED: 0.043,
  SGD: 0.0156,
  HKD: 0.091,
  AUD: 0.0172,
  CAD: 0.0158,
  NZD: 0.0193,
  CHF: 0.0102,
  KRW: 16.1,
  MYR: 0.053,
  IDR: 185,
  THB: 0.4,
  PHP: 0.66,
  VND: 296,
  PKR: 2.97,
  BDT: 1.37,
  LKR: 3.85,
  SAR: 0.044,
  ZAR: 0.21,
  MXN: 0.2,
  BRL: 0.058,
  TRY: 0.38,
  NOK: 0.125,
  SEK: 0.12,
  DKK: 0.079,
  PLN: 0.045,
  KWD: 0.0036
}

export const currencyCodeList = Object.keys(currencies)

export function convert(amount, from, to) {
  if (!amount) return 0
  const inINR = amount * (1 / ratesToINR[from])
  const out = inINR * ratesToINR[to]
  return Number(out.toFixed(4))
}

export function rate(from, to) {
  return Number((ratesToINR[to] / ratesToINR[from]).toFixed(5))
}

// 7-day synthetic trend for a pair (mock)
export function weeklyTrend(from, to) {
  const base = rate(from, to)
  const pattern = [0.998, 1.004, 1.001, 1.006, 1.009, 1.006, 1.012]
  const noise = [0, 0.5, -0.3, 0.8, 0.4, -0.6, 1.2]
  const dates = ['Sep 05', 'Sep 06', 'Sep 07', 'Sep 08', 'Sep 09', 'Sep 10', 'Sep 11']
  const start = base / pattern[pattern.length - 1]
  const scale = start
  return dates.map((date, i) => ({
    date,
    value: Number((scale * pattern[i] + noise[i] * base * 0.004).toFixed(5))
  }))
}

export const defaultTrend = [
  { date: 'Sep 05', value: 0.00882 },
  { date: 'Sep 06', value: 0.00893 },
  { date: 'Sep 07', value: 0.00888 },
  { date: 'Sep 08', value: 0.00902 },
  { date: 'Sep 09', value: 0.00912 },
  { date: 'Sep 10', value: 0.00905 },
  { date: 'Sep 11', value: 0.00918 }
]