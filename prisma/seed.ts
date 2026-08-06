import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Vigencia de la promoción: todos los premios se pueden redimir hasta el
// 31 de agosto inclusive, fin del día EN HORA DE COLOMBIA.
//
// El offset -05:00 va explícito a propósito. Sin él, `new Date('...T23:59:59')`
// se interpreta en la zona del proceso: correcto en un equipo en Colombia,
// pero el servidor de Render corre en UTC y los bonos vencerían a las 6:59 p.m.
// del 31, cinco horas antes de lo prometido.
//
// Cambiar esta constante y volver a sembrar actualiza el catálogo, pero NO los
// bonos ya entregados: cada uno se llevó su copia al crearse.
const VIGENCIA_HASTA = new Date('2026-08-31T23:59:59-05:00')

// Los 3 casinos. Se sincronizan por `clave`, así renombrar una sede o
// corregir su dirección no rompe los premios ni los canjes ya asociados.
const SEDES = [
  { clave: 'ventura-plaza', nombre: 'Gran Casino Cúcuta Ventura Plaza', direccion: 'CCial Ventura Plaza, Local 228', orden: 1 },
  { clave: 'av-5', nombre: 'Gran Casino Cúcuta Av. 5', direccion: 'Av. 5 # 9-30, Centro', orden: 2 },
  { clave: 'avenida-0', nombre: 'Gran Casino Cúcuta Av. 0', direccion: 'Av. 0 con calle 13, esquina', orden: 3 },
]

// Debe reflejar 1:1 el orden/weights de src/shared/data/prizes.ts en el
// frontend. `clave` es lo que conecta un registro de esta tabla con su
// ícono/color en el frontend (ver src/shared/data/prizes.ts).
//
// `sede` amarra cada premio a un casino: es la sede a la que se le dice al
// cliente que vaya a redimir. El reparto quedó balanceado por probabilidad
// (la suma de weights por sede), no por cantidad de premios:
//
//   Ventura Plaza  38%   ·  Av. 5  30%  ·  Av. 0  32%

const PREMIOS = [
  {
    clave: 'bono-5000',
    nombre: 'Bono de $5.000',
    detalle: 'Bono de juego a tu nombre. Preséntate en caja con tu cédula para reclamarlo.',
    monetario: true,
    weight: 25,
    sede: 'avenida-0',
  },
  {
    clave: 'bono-10000',
    nombre: 'Bono de $10.000',
    detalle: 'Bono de juego a tu nombre. Preséntate en caja con tu cédula para reclamarlo.',
    monetario: true,
    weight: 20,
    sede: 'av-5',
  },
  {
    clave: 'bono-20000',
    nombre: 'Bono de $20.000',
    detalle: 'Bono de juego a tu nombre. Preséntate en caja con tu cédula para reclamarlo.',
    monetario: true,
    weight: 20,
    sede: 'ventura-plaza',
  },
  {
    clave: 'carton-bingo',
    nombre: 'Cartón de Bingo Premium',
    detalle: 'Cartón para la próxima Maratón de Bingo. Preséntalo en caja para confirmar tu cupo. Cupos limitados.',
    monetario: false,
    weight: 8,
    sede: 'ventura-plaza',
  },
  {
    clave: 'entrada-evento',
    nombre: 'Entrada a Evento Especial',
    detalle: 'Acceso a nuestro próximo evento especial. Preséntate en caja con tu cédula.',
    monetario: false,
    weight: 7,
    sede: 'av-5',
  },
  {
    clave: 'bono-50000',
    nombre: 'Bono de $50.000',
    detalle: 'Nuestro bono de bienvenida mayor. Redímelo en caja presentando tu cédula.',
    monetario: true,
    weight: 6,
    sede: 'ventura-plaza',
  },
  {
    clave: 'premio-sorpresa',
    nombre: 'Premio Sorpresa',
    detalle: 'Hay un premio sorpresa esperándote. Ven a caja con tu cédula a descubrirlo.',
    monetario: false,
    weight: 4,
    sede: 'avenida-0',
  },
]

async function main() {
  // Las sedes van primero: los premios se enganchan a ellas por clave.
  for (const sede of SEDES) {
    await prisma.sede.upsert({
      where: { clave: sede.clave },
      update: sede,
      create: sede,
    })
  }

  const idPorClave = new Map(
    (await prisma.sede.findMany({ select: { id: true, clave: true } })).map((s) => [s.clave, s.id]),
  )

  for (const { sede, ...premio } of PREMIOS) {
    if (sede && !idPorClave.has(sede)) {
      throw new Error(`El premio "${premio.clave}" apunta a la sede "${sede}", que no existe en SEDES.`)
    }
    const datos = { ...premio, sedeId: sede ? idPorClave.get(sede)! : null, vigenciaHasta: VIGENCIA_HASTA }
    await prisma.premio.upsert({
      where: { clave: premio.clave },
      update: datos,
      create: datos,
    })
  }

  // Se imprime el reparto real para poder verificar de un vistazo que la
  // probabilidad quedó como se pretendía y que ningún premio quedó huérfano.
  const porSede = new Map<string, number>()
  for (const p of PREMIOS) porSede.set(p.sede, (porSede.get(p.sede) ?? 0) + p.weight)
  // Los weights son relativos, no porcentajes: se normalizan sobre el total
  // para que el número impreso sea la probabilidad real.
  const total = PREMIOS.reduce((suma, p) => suma + p.weight, 0)

  console.log(`Seed completo: ${SEDES.length} sedes y ${PREMIOS.length} premios sincronizados.`)
  console.log(`Vigencia de todos los premios: ${VIGENCIA_HASTA.toLocaleDateString('es-CO')}`)
  console.log('Reparto de probabilidad por sede:')
  for (const [sede, peso] of porSede) {
    console.log(`  ${sede.padEnd(15)} ${((peso / total) * 100).toFixed(1)}%`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
