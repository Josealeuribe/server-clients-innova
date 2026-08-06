// Elimina los clientes creados por las suites de pruebas end-to-end
// (src/pruebas/ del frontend), con sus consentimientos y bonos en cascada.
//
// SIMULA POR DEFECTO. Para borrar de verdad hay que pasar --confirmar:
//
//   npx tsx prisma/limpiar-datos-prueba.ts              (solo muestra)
//   npx tsx prisma/limpiar-datos-prueba.ts --confirmar  (borra)
//
// QUÉ SE BORRA
//   Clientes que cumplen LAS DOS condiciones a la vez: correo test-e2e-*@
//   example.com Y nombre "Prueba Automatizada". Se exigen las dos a propósito:
//   con una sola, un cliente real que por casualidad se llamara así, o que
//   usara un correo parecido, entraría en el borrado.
//
// QUÉ NO SE TOCA
//   · Las cuentas de personal (admin y cajero).
//   · Cualquier cliente que no cumpla ambas condiciones.
//   · Los visitantes anónimos: son los contadores del límite de 3 giros.
//     Borrarlos le devolvería giros gratis a quien ya los gastó, y no
//     contienen datos personales. Si aun así se quieren limpiar, hay que
//     hacerlo aparte y a conciencia.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const CORREO_DE_PRUEBA = 'test-e2e-'
const NOMBRES_DE_PRUEBA = 'Prueba'
const APELLIDOS_DE_PRUEBA = 'Automatizada'

const filtro = {
  email: { startsWith: CORREO_DE_PRUEBA },
  nombres: NOMBRES_DE_PRUEBA,
  apellidos: APELLIDOS_DE_PRUEBA,
}

async function main() {
  const confirmado = process.argv.includes('--confirmar')

  const totalAntes = await prisma.cliente.count()
  const aBorrar = await prisma.cliente.count({ where: filtro })
  const bonos = await prisma.bonoGanado.count({ where: { cliente: filtro } })
  const consentimientos = await prisma.consentimiento.count({ where: { cliente: filtro } })
  const staff = await prisma.usuario.count()

  console.log('--- Datos de prueba encontrados ---')
  console.log(`  clientes de prueba : ${aBorrar}`)
  console.log(`  sus bonos          : ${bonos}   (se van en cascada)`)
  console.log(`  sus consentimientos: ${consentimientos}   (se van en cascada)`)
  console.log('')
  console.log('--- Se conservan ---')
  console.log(`  clientes reales    : ${totalAntes - aBorrar}`)
  console.log(`  cuentas de personal: ${staff}`)
  console.log(`  visitantes anónimos: ${await prisma.visitanteAnonimo.count()}   (contadores del límite de giros)`)
  console.log('')

  const reales = await prisma.cliente.findMany({
    where: { NOT: filtro },
    select: { nombres: true, apellidos: true, email: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log('Clientes que NO se borran:')
  for (const c of reales) console.log(`  · ${c.nombres} ${c.apellidos} <${c.email}>`)
  console.log('')

  if (!confirmado) {
    console.log('SIMULACIÓN: no se borró nada. Repite con --confirmar para ejecutar.')
    return
  }

  const { count } = await prisma.cliente.deleteMany({ where: filtro })
  const totalDespues = await prisma.cliente.count()

  console.log(`Borrados ${count} clientes de prueba.`)
  console.log(`Clientes restantes: ${totalDespues}`)

  // Comprobación explícita: si algo salió distinto de lo previsto, que se vea.
  if (totalDespues !== totalAntes - aBorrar) {
    throw new Error(
      `Recuento inesperado: se esperaban ${totalAntes - aBorrar} clientes y quedaron ${totalDespues}.`,
    )
  }
  if ((await prisma.usuario.count()) !== staff) {
    throw new Error('Las cuentas de personal cambiaron. Esto no debería pasar nunca.')
  }
  console.log('Verificación correcta: personal intacto y solo se fueron los de prueba.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
