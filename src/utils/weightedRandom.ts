// Misma lógica que src/shared/utils/weightedRandom.ts en el frontend, pero
// esta es la que realmente decide el premio: el sorteo del frontend es
// puramente visual (a qué casilla apunta la ruleta 3D).
export function weightedRandomIndex(weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0)
  let roll = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]
    if (roll < 0) return i
  }
  return weights.length - 1
}
