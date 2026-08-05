// Genera un código de canje legible tipo "GCC-2026-8A4F" para que el
// jugador lo presente en caja en cualquiera de las sedes.
export function generarCodigoCanje(): string {
  const year = new Date().getFullYear()
  const random = Array.from({ length: 4 }, () =>
    '0123456789ABCDEF'[Math.floor(Math.random() * 16)],
  ).join('')
  return `GCC-${year}-${random}`
}
