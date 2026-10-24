FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
COPY backend/prisma/schema.prisma ./backend/prisma/schema.prisma
COPY backend/prisma.config.ts ./backend/prisma.config.ts

RUN npm ci

COPY . .

RUN DATABASE_URL="postgresql://user:password@localhost:5432/studyroom" npm run db:generate --workspace backend && npm run build
ENV NODE_ENV=production

CMD ["sh", "-c", "npm run db:deploy && npm run admin:create && npm run start --workspace backend"]
