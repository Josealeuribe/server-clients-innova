import { randomInt } from 'node:crypto'

const ALFABETO = '0123456789ABCDEF'
const LONGITUD = 6

// Genera un código de canje legible tipo "GCC-2026-8A4F2C" para que el
// jugador lo presente en caja.
//
// Dos decisiones pensadas contra el fraude:
//
// 1. `randomInt` de node:crypto y no Math.random. Math.random es un PRNG
//    predecible: conociendo unas cuantas salidas se puede inferir el estado
//    del generador y anticipar los códigos siguientes. Un código de canje es
//    un secreto de portador — quien lo tenga se lleva el premio — así que no
//    puede salir de un generador adivinable.
//
// 2. Seis caracteres hex (16.7 millones de combinaciones) en vez de cuatro
//    (65.536). Con cuatro, por la paradoja del cumpleaños, bastaban ~300
//    bonos para que ya fuera más probable que no que existiera una colisión;
//    se resolvía reintentando, pero además hacía viable adivinar códigos a lo
//    bruto. Con seis, ambas cosas dejan de ser un problema realista.
//
// La unicidad REAL la garantiza la base (BonoGanado.codigo es @unique): esto
// solo hace que las colisiones sean tan raras que el reintento casi nunca
// tenga que actuar.
export function generarCodigoCanje(): string {
  const year = new Date().getFullYear()
  const random = Array.from({ length: LONGITUD }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')
  return `GCC-${year}-${random}`
}
