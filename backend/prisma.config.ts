import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const datasourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!datasourceUrl) {
  throw new Error('Define DIRECT_URL ou DATABASE_URL pour utiliser Prisma.')
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: datasourceUrl },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
