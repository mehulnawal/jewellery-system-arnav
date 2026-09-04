// Keep Round last. New shapes deliberately sort just before it.
export const SHAPE_ORDER = ['Pan', 'Marquise', 'Oval', 'Emerlad', 'Princess', 'Cushion', 'Radiant', 'Choki', 'Taper (Choki)', 'Buget (Choki)', 'Trillion']
export const DEFAULT_SHAPES = [...SHAPE_ORDER, 'Round']

export const formatDecimal = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(3) : ''
}

export const normalizeBox = (value) => String(value ?? '').trim().toUpperCase()
export const isValidBox = (value) => value === '' || /^[A-Z]+\d+$/.test(value)
export const normalizeSize = (value) => String(value ?? '').trim()
export const isValidSize = (value, allowDimensions = false) => {
  const size = normalizeSize(value)
  if (/^\d+(?:\.\d+)?$/.test(size)) return Number(size) > 0
  if (!allowDimensions || !/^\d+(?:\.\d+)?X\d+(?:\.\d+)?$/.test(size)) return false
  return size.split('X').every((part) => Number(part) > 0)
}

export const sizeSortValue = (value) => Number(String(value ?? '').split('X')[0]) || 0
export const orderShapes = (shapes) => [...new Set(shapes.filter(Boolean))].sort((a, b) => {
  const rank = (shape) => {
    if (shape === 'Round') return Number.MAX_SAFE_INTEGER
    if (shape === 'Emerald') return SHAPE_ORDER.indexOf('Emerlad')
    return SHAPE_ORDER.indexOf(shape) === -1 ? SHAPE_ORDER.length : SHAPE_ORDER.indexOf(shape)
  }
  return rank(a) - rank(b) || a.localeCompare(b)
})

export const parseSizeQuery = (query) => {
  const normalized = String(query ?? '').trim().toLowerCase()
  const match = normalized.match(/^(\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?)mm$/i)
  return match ? { sizeOnly: true, value: match[1].replace('x', 'X') } : { sizeOnly: false, value: normalized }
}

export const numericMatches = (value, query) => {
  const valueParts = String(value ?? '').split('X')
  const queryParts = String(query ?? '').trim().toUpperCase().split('X')
  if (valueParts.length !== queryParts.length || !queryParts.every((part) => /^\d+(?:\.\d*)?$/.test(part))) return false
  return valueParts.every((part, index) => {
    const number = Number(part)
    const asked = queryParts[index]
    return Number.isFinite(number) && (number === Number(asked) || String(number).includes(asked) || formatDecimal(number).includes(asked))
  })
}

export const inventoryMatchesSearch = (item, query) => {
  const parsed = parseSizeQuery(query)
  if (!parsed.value) return true
  if (parsed.sizeOnly) return String(item.size ?? '').toLowerCase() === parsed.value.toLowerCase()
  return [item.shape, item.type, item.sku, item.group, item.box].some((value) => String(value ?? '').toLowerCase().includes(parsed.value)) || numericMatches(item.size, parsed.value) || numericMatches(item.weight, parsed.value)
}
