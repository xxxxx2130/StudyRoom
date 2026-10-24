import 'dotenv/config'
import { PrismaClient, UserRole } from '@prisma/client'
import { hashPassword } from './auth.js'

const prisma = new PrismaClient()

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  const firstName = process.env.ADMIN_FIRST_NAME?.trim() || 'Admin'
  const lastName = process.env.ADMIN_LAST_NAME?.trim() || 'SchoolRoom'

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Définissez ADMIN_EMAIL avec une adresse e-mail valide.')
  }

  if (!password || password.length < 12 || password.length > 128) {
    throw new Error('Définissez ADMIN_PASSWORD (12 à 128 caractères).')
  }

  const existingAdmin = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })

  if (existingAdmin) {
    console.log('Le compte existe déjà : aucune modification effectuée.')
    return
  }

  const passwordHash = await hashPassword(password)

  await prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      role: UserRole.ADMIN,
      passwordHash,
    },
  })

  console.log(`Compte administrateur créé : ${email}`)
}

main()
  .catch((error: unknown) => {
    console.error('Impossible de créer le compte administrateur :', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })