import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// Cuentas de personal interno. No hay auto-registro para admin/cajero — se
// siembran una sola vez aquí. Para agregar más cajeros/admins más adelante,
// añade entradas a esta lista y vuelve a correr `npm run prisma:seed-staff`
// (usa upsert, así que es seguro re-ejecutarlo).
const STAFF = [
  { nombre: 'Administrador', email: 'admin@grancasino.com.co', password: 'AdminCucuta0508', rol: 'admin' },
  { nombre: 'Cajero', email: 'cajero@grancasino.com.co', password: 'CajeroCucuta0805', rol: 'cajero' },
]

async function main() {
  for (const staff of STAFF) {
    const passwordHash = await bcrypt.hash(staff.password, 10)
    await prisma.usuario.upsert({
      where: { email: staff.email },
      update: { nombre: staff.nombre, rol: staff.rol },
      create: { nombre: staff.nombre, email: staff.email, passwordHash, rol: staff.rol },
    })
  }
  console.log(`Seed de staff completo: ${STAFF.length} cuentas sincronizadas.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
