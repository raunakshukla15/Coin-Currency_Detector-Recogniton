export const coinTypes = {
  rupee10: 'Bimetallic',
  rupee1: 'Silver',
  eic: 'Silver',
  tetradrachm: 'Silver',
  drape: 'Silver',
  morgan: 'Silver',
  anna: 'Gold/Silver',
  sestertius: 'Bronze',
  commem: 'Commemorative',
  kushan: 'Gold'
}

export const coins = [
  {
    id: 'rupee10-2010',
    type: 'rupee10',
    name: '10 Rupees (₹10)',
    country: 'India',
    year: '2010 – Present',
    denomination: '10 Rupees (₹10)',
    composition: 'Bimetallic\n(Cu-Ni center, Al-Bronze ring)',
    weight: '7.71 grams',
    diameter: '27 mm',
    shape: 'Round',
    obverse: 'Ashoka Lion Capital\n(Satyameva Jayate)',
    reverse: '₹10 with decorative rays',
    description:
      'The ₹10 coin is part of the Indian circulation series, featuring the Ashoka Lion Capital on the obverse and the denomination on the reverse. It is widely used in everyday transactions across India.',
    valueRange: [10, 150],
    rarity: 'Common',
    category: 'Modern',
    status: 'VERIFIED',
    grade: '',
    match: 92,
    tags: ['Bimetallic', 'Circulation', 'India'],
    price: 150
  },
  {
    id: 'rupee10-2016',
    type: 'rupee10',
    name: '10 Rupees (₹10)',
    country: 'India',
    year: '2016',
    denomination: '10 Rupees (₹10)',
    composition: 'Bimetallic\n(Cu-Ni center, Al-Bronze ring)',
    weight: '7.71 grams',
    diameter: '27 mm',
    shape: 'Round',
    obverse: 'Ashoka Lion Capital\n(Satyameva Jayate)',
    reverse: '₹10 with decorative rays',
    description:
      'A 2016-dated ₹10 bimetallic circulation coin with the Lion Capital obverse and large denominational design on the reverse.',
    valueRange: [10, 140],
    rarity: 'Common',
    category: 'Modern',
    status: 'VERIFIED',
    grade: '',
    match: 88,
    tags: ['Bimetallic', 'Circulation'],
    price: 140
  },
  {
    id: 'rupee10-2020',
    type: 'rupee10',
    name: '10 Rupees (₹10)',
    country: 'India',
    year: '2020',
    denomination: '10 Rupees (₹10)',
    composition: 'Bimetallic\n(Cu-Ni center, Al-Bronze ring)',
    weight: '7.71 grams',
    diameter: '27 mm',
    shape: 'Round',
    obverse: 'Ashoka Lion Capital\n(Satyameva Jayate)',
    reverse: '₹10 with decorative rays',
    description:
      'Modern ₹10 bimetallic issue — a continuation of the standard Indian circulation design.',
    valueRange: [10, 160],
    rarity: 'Common',
    category: 'Modern',
    status: 'VERIFIED',
    grade: '',
    match: 90,
    tags: ['Bimetallic', 'Circulation'],
    price: 160
  },
  {
    id: 'rupee10-commem',
    type: 'rupee10',
    name: '10 Rupees (Commemorative)',
    country: 'India',
    year: '2017',
    denomination: '10 Rupees (₹10)',
    composition: 'Bimetallic\n(Cu-Ni center, Al-Bronze ring)',
    weight: '7.71 grams',
    diameter: '27 mm',
    shape: 'Round',
    obverse: 'Ashoka Lion Capital',
    reverse: 'Commemorative motif',
    description:
      'A limited commemorative ₹10 issue with a special reverse motif, collected by numismatists for its distinctive design.',
    valueRange: [150, 900],
    rarity: 'Common',
    category: 'Commemorative',
    status: 'VERIFIED',
    grade: '',
    match: 85,
    tags: ['Bimetallic', 'Commemorative'],
    price: 650
  }
]

export const seedCollection = [
  {
    id: 'eic-1835',
    type: 'eic',
    name: '1835 East India 1 Rupee',
    country: 'India',
    year: '1835',
    category: 'Rare',
    status: 'VERIFIED',
    grade: 'AU-55',
    match: 97,
    tags: ['Company', 'Silver', 'Victoria'],
    price: 42000,
    favorite: false
  },
  {
    id: 'tetradrachm-athens',
    type: 'tetradrachm',
    name: 'Greek Silver Tetradrachm',
    country: 'Greece',
    year: '440 BC',
    category: 'Ancient',
    status: 'VERIFIED',
    grade: 'EF-40',
    match: 95,
    tags: ['Athens', 'Owl', 'Classical'],
    price: 120000,
    favorite: true
  },
  {
    id: 'drape-1804',
    type: 'drape',
    name: '1804 Draped Bust Dollar',
    country: 'United States',
    year: '1804',
    category: 'Rare',
    status: 'GRADED',
    grade: 'PR-62',
    match: 93,
    tags: ['Dollar', 'Key Date', 'US'],
    price: 115000,
    favorite: true
  },
  {
    id: 'rupee10-2010-col',
    type: 'rupee10',
    name: '10 Rupees (₹10) · 2010',
    country: 'India',
    year: '2010',
    category: 'Modern',
    status: 'VERIFIED',
    grade: '',
    match: 92,
    tags: ['Bimetallic', 'Circulation'],
    price: 150,
    favorite: false
  },
  {
    id: 'anna-1908',
    type: 'anna',
    name: '1908 1 Anna · King Edward VII',
    country: 'India',
    year: '1908',
    category: 'Gold/Silver',
    status: 'GRADED',
    grade: 'AU-50',
    match: 91,
    tags: ['British India', 'Edward VII'],
    price: 30000,
    favorite: false
  },
  {
    id: 'commem-1947',
    type: 'commem',
    name: '1947 Independence Commemorative',
    country: 'India',
    year: '1947',
    category: 'Commemorative',
    status: 'PENDING',
    grade: '',
    match: 86,
    tags: ['Independence', 'Collection'],
    price: 2200,
    favorite: true
  },
  {
    id: 'sestertius-roman',
    type: 'sestertius',
    name: 'Roman Bronze Sestertius',
    country: 'Roman Empire',
    year: 'c. 117 AD',
    category: 'Ancient',
    status: 'PENDING',
    grade: '',
    match: 84,
    tags: ['Rome', 'Bronze', 'SC'],
    price: 8000,
    favorite: false
  },
  {
    id: 'rup5-1985',
    type: 'rupee1',
    name: '5 Rupees (₹5) · 1985',
    country: 'India',
    year: '1985',
    category: 'Modern',
    status: 'PENDING',
    grade: '',
    match: 82,
    tags: ['Circulation', 'Cupro-Nickel'],
    price: 900,
    favorite: false
  }
]

export const getCoin = (id) => coins.find((c) => c.id === id) || seedCollection.find((c) => c.id === id) || null

export const allCoinTypes = [
  {
    id: 'gold',
    label: 'Gold/Silver',
    desc: 'Precious metal coins'
  },
  {
    id: 'rare',
    label: 'Rare',
    desc: 'Key dates & rarities'
  },
  {
    id: 'ancient',
    label: 'Ancient',
    desc: 'Classical & old world'
  },
  {
    id: 'modern',
    label: 'Modern',
    desc: 'Modern circulation'
  },
  {
    id: 'commemorative',
    label: 'Commemorative',
    desc: 'Special issues'
  }
]