import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Debe reflejar 1:1 el orden/weights de src/shared/data/prizes.ts en el
// frontend. `clave` es lo que conecta un registro de esta tabla con su
// ícono/color en el frontend (ver src/shared/data/prizes.ts).
const PREMIOS = [
  {
    clave: 'bono-5000',
    nombre: 'Bono de $5.000',
    detalle: 'Bono redimible en cualquiera de nuestras 3 sedes al completar tu registro.',
    monetario: true,
    weight: 25,
  },
  {
    clave: 'bono-10000',
    nombre: 'Bono de $10.000',
    detalle: 'Bono redimible en cualquiera de nuestras 3 sedes al completar tu registro.',
    monetario: true,
    weight: 20,
  },
  {
    clave: 'bono-20000',
    nombre: 'Bono de $20.000',
    detalle: 'Bono redimible en cualquiera de nuestras 3 sedes al completar tu registro.',
    monetario: true,
    weight: 20,
  },
  {
    clave: 'giro-extra',
    nombre: 'Giro Adicional en la Ruleta',
    detalle: 'Vuelve a girar y gana otro premio.',
    monetario: false,
    weight: 10,
  },
  {
    clave: 'carton-bingo',
    nombre: 'Cartón de Bingo Premium',
    detalle: 'Para el próximo evento en vivo del club, canjeable en caja.',
    monetario: false,
    weight: 8,
  },
  {
    clave: 'entrada-evento',
    nombre: 'Entrada a Evento Especial',
    detalle: 'Acceso a nuestro próximo evento especial en sede.',
    monetario: false,
    weight: 7,
  },
  {
    clave: 'bono-50000',
    nombre: 'Bono de $50.000',
    detalle: 'Nuestro bono de bienvenida mayor, redimible en sede al completar tu registro.',
    monetario: true,
    weight: 6,
  },
  {
    clave: 'premio-sorpresa',
    nombre: 'Premio Sorpresa',
    detalle: 'Una cortesía especial de Gran Casino Cucuta, disponible en sede.',
    monetario: false,
    weight: 4,
  },
]

async function main() {
  for (const premio of PREMIOS) {
    await prisma.premio.upsert({
      where: { clave: premio.clave },
      update: premio,
      create: premio,
    })
  }
  console.log(`Seed completo: ${PREMIOS.length} premios sincronizados.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
