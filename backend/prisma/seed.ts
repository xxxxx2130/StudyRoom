import {
  PrismaClient,
} from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const roomA = await prisma.room.upsert({
    where: { code: 'A-101' },
    update: {
      name: 'Salle de travail A-101',
      location: 'Bâtiment A, 1er étage',
      capacity: 8,
      description: 'Salle calme avec tableau blanc.',
      isActive: true,
    },
    create: {
      code: 'A-101',
      name: 'Salle de travail A-101',
      location: 'Bâtiment A, 1er étage',
      capacity: 8,
      description: 'Salle calme avec tableau blanc.',
    },
  })

  await prisma.room.upsert({
    where: { code: 'B-204' },
    update: {
      name: 'Salle de projet B-204',
      location: 'Bâtiment B, 2e étage',
      capacity: 16,
      description: 'Salle équipée pour le travail en groupe.',
      isActive: true,
    },
    create: {
      code: 'B-204',
      name: 'Salle de projet B-204',
      location: 'Bâtiment B, 2e étage',
      capacity: 16,
      description: 'Salle équipée pour le travail en groupe.',
    },
  })

  await prisma.roomUnavailability.upsert({
    where: { id: 'demo-unavailability-1' },
    update: {
      roomId: roomA.id,
      startAt: new Date('2030-05-20T12:00:00.000Z'),
      endAt: new Date('2030-05-20T14:00:00.000Z'),
      reason: 'Maintenance planifiée',
    },
    create: {
      id: 'demo-unavailability-1',
      roomId: roomA.id,
      startAt: new Date('2030-05-20T12:00:00.000Z'),
      endAt: new Date('2030-05-20T14:00:00.000Z'),
      reason: 'Maintenance planifiée',
    },
  })

  console.log('Salles de démonstration insérées.')
  console.log('Salles : A-101, B-204')
}

main().finally(async () => {
  await prisma.$disconnect()
})
