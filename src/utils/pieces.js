export const isWholePieces = value => value !== '' && value !== null && value !== undefined && /^\d+$/.test(String(value).trim())
export const pieceValue = value => isWholePieces(value) ? Number.parseInt(String(value), 10) : 0
export const formatPieces = value => String(pieceValue(value))