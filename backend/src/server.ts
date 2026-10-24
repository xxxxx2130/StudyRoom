import 'dotenv/config'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Prisma,
  PrismaClient,
  ReservationStatus,
  UserRole,
} from '@prisma/client'
import { hashPassword, verifyPassword } from './auth.js'

const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
const prisma = new PrismaClient()
const frontendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000
const loginAttempts = new Map<string, number[]>()
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

type PublicUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  })
  response.end(JSON.stringify(value))
}

async function serveFrontend(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
) {
  if (
    process.env.NODE_ENV !== 'production' ||
    (request.method !== 'GET' && request.method !== 'HEAD')
  ) {
    return false
  }

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    throw new HttpError(400, 'L’adresse demandée est invalide.')
  }

  const requestedFile = resolve(frontendDirectory, `.${decodedPath}`)
  if (requestedFile !== frontendDirectory && !requestedFile.startsWith(`${frontendDirectory}${sep}`)) {
    return false
  }

  let filePath = requestedFile
  try {
    const fileInfo = await stat(requestedFile)
    if (fileInfo.isDirectory()) {
      filePath = resolve(requestedFile, 'index.html')
    } else if (!fileInfo.isFile()) {
      return false
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
    if (extname(decodedPath)) {
      return false
    }
    filePath = resolve(frontendDirectory, 'index.html')
  }

  const content = await readFile(filePath)
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  })
  response.end(request.method === 'HEAD' ? undefined : content)
  return true
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.includes('application/json')) {
    throw new HttpError(415, 'Le format de la requête doit être JSON.')
  }

  const parsedRequest = request as IncomingMessage & { body?: unknown }
  if (parsedRequest.body !== undefined) {
    const body = JSON.stringify(parsedRequest.body)
    if (body.length > 16_384) {
      throw new HttpError(413, 'La requête est trop volumineuse.')
    }
    if (
      typeof parsedRequest.body !== 'object' ||
      parsedRequest.body === null ||
      Array.isArray(parsedRequest.body)
    ) {
      throw new HttpError(400, 'Le contenu de la requête est invalide.')
    }
    return parsedRequest.body as Record<string, unknown>
  }

  let body = ''
  for await (const chunk of request) {
    body += chunk.toString()
    if (body.length > 16_384) {
      throw new HttpError(413, 'La requête est trop volumineuse.')
    }
  }

  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new HttpError(400, 'Le contenu de la requête est invalide.')
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'Le contenu de la requête est invalide.')
  }

  return value as Record<string, unknown>
}

function requiredText(
  body: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
) {
  const value = body[key]
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new HttpError(400, `${label} est obligatoire (maximum ${maxLength} caractères).`)
  }
  return value.trim()
}

function parseDate(value: unknown, label: string) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new HttpError(400, `${label} doit être une date valide.`)
  }

  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new HttpError(400, `${label} doit être une date valide.`)
  }
  return date
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function cookieValue(request: IncomingMessage, name: string) {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  return cookie?.slice(name.length + 1)
}

function sessionCookie(token: string, maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `schoolroom_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
}

async function establishSession(userId: string, response: ServerResponse) {
  const token = randomBytes(32).toString('hex')
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + sessionLifetimeMs),
    },
  })
  return sessionCookie(token, sessionLifetimeMs / 1000)
}

async function requireUser(request: IncomingMessage): Promise<PublicUser> {
  const token = cookieValue(request, 'schoolroom_session')
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    throw new HttpError(401, 'Connectez-vous pour continuer.')
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, role: true } } },
  })
  if (!session || session.expiresAt <= new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } })
    }
    throw new HttpError(401, 'Votre session a expiré. Reconnectez-vous.')
  }
  return session.user
}

async function requireAdmin(request: IncomingMessage) {
  const user = await requireUser(request)
  if (user.role !== UserRole.ADMIN) {
    throw new HttpError(403, 'Accès réservé à l’administration.')
  }
  return user
}

function checkSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin
  if (!origin) {
    return
  }
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw new HttpError(403, 'Origine de requête invalide.')
  }
  const forwardedHost = process.env.NODE_ENV === 'production'
    ? undefined
    : request.headers['x-forwarded-host']
  const requestHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost ?? request.headers.host
  if (originHost !== requestHost) {
    throw new HttpError(403, 'Cette requête n’est pas autorisée.')
  }
}

function enforceRateLimit(request: IncomingMessage, bucket: string) {
  const now = Date.now()
  const ip = request.socket.remoteAddress ?? 'unknown'
  const key = `${bucket}:${ip}`
  const attempts = (loginAttempts.get(key) ?? []).filter((timestamp) => now - timestamp < 15 * 60_000)
  if (attempts.length >= 10) {
    throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.')
  }
  attempts.push(now)
  loginAttempts.set(key, attempts)
}

function validateEmail(email: string) {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'L’adresse e-mail n’est pas valide.')
  }
  return email.toLowerCase()
}

function parseRoomInput(body: Record<string, unknown>) {
  const code = requiredText(body, 'code', 'Le code', 20).toUpperCase()
  if (!/^[A-Z0-9-]+$/.test(code)) {
    throw new HttpError(400, 'Le code doit contenir uniquement des lettres, chiffres ou tirets.')
  }
  const capacity = body.capacity
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    throw new HttpError(400, 'La capacité doit être un nombre entier entre 1 et 500.')
  }

  const description = body.description
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new HttpError(400, 'La description est invalide.')
  }

  return {
    code,
    name: requiredText(body, 'name', 'Le nom', 120),
    location: requiredText(body, 'location', 'L’emplacement', 120),
    capacity,
    description: typeof description === 'string' && description.trim() ? description.trim().slice(0, 500) : null,
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const { pathname } = url
  const method = request.method ?? 'GET'

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    checkSameOrigin(request)
  }

  if ((pathname === '/health' || pathname === '/api/health') && method === 'GET') {
    sendJson(response, 200, { status: 'ok' })
    return
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    enforceRateLimit(request, 'register')
    const body = await readJson(request)
    const firstName = requiredText(body, 'firstName', 'Le prénom', 80)
    const lastName = requiredText(body, 'lastName', 'Le nom', 80)
    const email = validateEmail(requiredText(body, 'email', 'L’adresse e-mail', 254))
    const password = requiredText(body, 'password', 'Le mot de passe', 128)
    const role = body.role
    if (role !== UserRole.STUDENT && role !== UserRole.TEACHER) {
      throw new HttpError(400, 'Choisissez un compte étudiant ou enseignant.')
    }
    if (password.length < 12) {
      throw new HttpError(400, 'Le mot de passe doit contenir au moins 12 caractères.')
    }

    const passwordHash = await hashPassword(password)
    let user: PublicUser
    try {
      user = await prisma.user.create({
        data: { firstName, lastName, email, passwordHash, role },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'Un compte existe déjà avec cette adresse e-mail.')
      }
      throw error
    }

    const cookie = await establishSession(user.id, response)
    sendJson(response, 201, { user }, { 'Set-Cookie': cookie })
    return
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    enforceRateLimit(request, 'login')
    const body = await readJson(request)
    const email = validateEmail(requiredText(body, 'email', 'L’adresse e-mail', 254))
    const password = requiredText(body, 'password', 'Le mot de passe', 128)
    const requestedRole = body.role
    if (
      requestedRole !== UserRole.STUDENT &&
      requestedRole !== UserRole.TEACHER &&
      requestedRole !== UserRole.ADMIN
    ) {
      throw new HttpError(400, 'Choisissez le type de compte avec lequel vous souhaitez vous connecter.')
    }
    const userRecord = await prisma.user.findUnique({ where: { email } })
    const valid = userRecord
      ? await verifyPassword(password, userRecord.passwordHash)
      : await verifyPassword(password, '00000000000000000000000000000000:' + '0'.repeat(128))
    if (!userRecord || !valid || userRecord.role !== requestedRole) {
      throw new HttpError(401, 'Adresse e-mail ou mot de passe incorrect.')
    }

    const user: PublicUser = {
      id: userRecord.id,
      email: userRecord.email,
      firstName: userRecord.firstName,
      lastName: userRecord.lastName,
      role: userRecord.role,
    }
    const cookie = await establishSession(user.id, response)
    sendJson(response, 200, { user }, { 'Set-Cookie': cookie })
    return
  }

  if (pathname === '/api/auth/session' && method === 'GET') {
    const user = await requireUser(request)
    sendJson(response, 200, { user })
    return
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = cookieValue(request, 'schoolroom_session')
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
    }
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) })
    return
  }

  if (pathname === '/api/rooms' && method === 'GET') {
    const rooms = await prisma.room.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        location: true,
        capacity: true,
        description: true,
      },
    })
    sendJson(response, 200, { rooms })
    return
  }

  if (pathname === '/api/availability' && method === 'GET') {
    await requireUser(request)
    const startAt = parseDate(url.searchParams.get('startAt'), 'Le début')
    const endAt = parseDate(url.searchParams.get('endAt'), 'La fin')
    const capacityValue = url.searchParams.get('capacity')
    if (!capacityValue || !/^\d+$/.test(capacityValue)) {
      throw new HttpError(400, 'La capacité doit être un nombre entier positif.')
    }
    const capacity = Number(capacityValue)
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 500) {
      throw new HttpError(400, 'La capacité doit être comprise entre 1 et 500 places.')
    }
    if (startAt <= new Date()) {
      throw new HttpError(400, 'Le créneau doit commencer dans le futur.')
    }
    if (endAt <= startAt || endAt.getTime() - startAt.getTime() > 12 * 60 * 60_000) {
      throw new HttpError(400, 'La durée doit être positive et ne pas dépasser 12 heures.')
    }

    const rooms = await prisma.room.findMany({
      where: {
        isActive: true,
        capacity: { gte: capacity },
        reservations: {
          none: {
            status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        },
        unavailabilities: {
          none: {
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        },
      },
      orderBy: [{ capacity: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        location: true,
        capacity: true,
        description: true,
      },
    })
    sendJson(response, 200, { rooms })
    return
  }

  if (pathname === '/api/calendar' && method === 'GET') {
    await requireAdmin(request)
    const startAt = parseDate(url.searchParams.get('start'), 'Le début de l’agenda')
    const endAt = parseDate(url.searchParams.get('end'), 'La fin de l’agenda')
    if (endAt <= startAt || endAt.getTime() - startAt.getTime() > 14 * 24 * 60 * 60_000) {
      throw new HttpError(400, 'La période de l’agenda doit durer au maximum 14 jours.')
    }
    const reservations = await prisma.reservation.findMany({
      where: {
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
      },
      orderBy: { startAt: 'asc' },
      take: 500,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        room: { select: { id: true, code: true, name: true } },
      },
    })
    sendJson(response, 200, { reservations })
    return
  }

  if (pathname === '/api/reservations' && method === 'GET') {
    const user = await requireUser(request)
    const reservations = await prisma.reservation.findMany({
      where: { userId: user.id },
      orderBy: { startAt: 'desc' },
      take: 100,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        purpose: true,
        status: true,
        room: { select: { id: true, code: true, name: true } },
      },
    })
    sendJson(response, 200, { reservations })
    return
  }

  if (pathname === '/api/reservations' && method === 'POST') {
    const user = await requireUser(request)
    const body = await readJson(request)
    const roomId = requiredText(body, 'roomId', 'La salle', 64)
    const purpose = requiredText(body, 'purpose', 'Le motif', 500)
    const startAt = parseDate(body.startAt, 'Le début')
    const endAt = parseDate(body.endAt, 'La fin')

    if (startAt <= new Date()) {
      throw new HttpError(400, 'La réservation doit commencer dans le futur.')
    }
    if (endAt <= startAt || endAt.getTime() - startAt.getTime() > 12 * 60 * 60_000) {
      throw new HttpError(400, 'La durée doit être positive et ne pas dépasser 12 heures.')
    }

    const reservation = await prisma.$transaction(async (transaction) => {
      const room = await transaction.room.findFirst({
        where: { id: roomId, isActive: true },
        select: { id: true },
      })
      if (!room) {
        throw new HttpError(404, 'Cette salle n’est pas disponible.')
      }

      const existingReservation = await transaction.reservation.findFirst({
        where: {
          roomId,
          status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      })
      if (existingReservation) {
        throw new HttpError(409, 'Cette salle est déjà réservée sur ce créneau.')
      }

      const unavailable = await transaction.roomUnavailability.findFirst({
        where: {
          roomId,
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      })
      if (unavailable) {
        throw new HttpError(409, 'Cette salle est indisponible sur ce créneau.')
      }

      return transaction.reservation.create({
        data: {
          roomId,
          userId: user.id,
          startAt,
          endAt,
          purpose,
          status: ReservationStatus.CONFIRMED,
        },
        select: {
          id: true,
          startAt: true,
          endAt: true,
          status: true,
          purpose: true,
          room: { select: { id: true, code: true, name: true } },
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    sendJson(response, 201, { reservation })
    return
  }

  const reservationRoute = pathname.match(/^\/api\/reservations\/([^/]+)$/)
  if (reservationRoute && method === 'PATCH') {
    const user = await requireUser(request)
    const reservationId = decodeURIComponent(reservationRoute[1])
    const body = await readJson(request)
    const status = body.status
    const existing = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, userId: true, roomId: true, status: true, startAt: true, endAt: true },
    })
    if (!existing) {
      throw new HttpError(404, 'Cette réservation est introuvable.')
    }

    if (user.role === UserRole.ADMIN) {
      if (status !== ReservationStatus.CONFIRMED && status !== ReservationStatus.REJECTED) {
        throw new HttpError(400, 'L’administration peut confirmer ou refuser une demande.')
      }
      await prisma.$transaction(async (transaction) => {
        const current = await transaction.reservation.findUnique({
          where: { id: reservationId },
          select: { id: true, roomId: true, status: true, startAt: true, endAt: true },
        })
        if (!current || current.status !== ReservationStatus.PENDING) {
          throw new HttpError(409, 'Cette demande a déjà été traitée.')
        }
        if (status === ReservationStatus.CONFIRMED) {
          const conflict = await transaction.reservation.findFirst({
            where: {
              id: { not: current.id },
              roomId: current.roomId,
              status: ReservationStatus.CONFIRMED,
              startAt: { lt: current.endAt },
              endAt: { gt: current.startAt },
            },
            select: { id: true },
          })
          if (conflict) {
            throw new HttpError(409, 'Une autre réservation confirmée occupe déjà ce créneau.')
          }
          const unavailable = await transaction.roomUnavailability.findFirst({
            where: {
              roomId: current.roomId,
              startAt: { lt: current.endAt },
              endAt: { gt: current.startAt },
            },
            select: { id: true },
          })
          if (unavailable) {
            throw new HttpError(409, 'La salle est indisponible sur ce créneau.')
          }
        }
        const result = await transaction.reservation.updateMany({
          where: { id: reservationId, status: ReservationStatus.PENDING },
          data: { status },
        })
        if (!result.count) {
          throw new HttpError(409, 'Cette demande a déjà été traitée.')
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } else if (
      existing.userId !== user.id ||
      status !== ReservationStatus.CANCELLED ||
      existing.status === ReservationStatus.REJECTED ||
      existing.status === ReservationStatus.CANCELLED ||
      existing.startAt <= new Date()
    ) {
      throw new HttpError(403, 'Vous ne pouvez pas modifier cette réservation.')
    } else {
      const result = await prisma.reservation.updateMany({
        where: {
          id: reservationId,
          userId: user.id,
          status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
          startAt: { gt: new Date() },
        },
        data: { status: ReservationStatus.CANCELLED },
      })
      if (!result.count) {
        throw new HttpError(409, 'Cette réservation ne peut plus être annulée.')
      }
    }

    sendJson(response, 200, { reservation: { id: reservationId, status } })
    return
  }

  if (pathname === '/api/admin/reservations' && method === 'GET') {
    await requireAdmin(request)
    const reservations = await prisma.reservation.findMany({
      orderBy: [{ startAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        purpose: true,
        status: true,
        user: { select: { firstName: true, lastName: true, email: true } },
        room: { select: { code: true, name: true } },
      },
    })
    sendJson(response, 200, { reservations })
    return
  }

  if (pathname === '/api/admin/rooms' && method === 'GET') {
    await requireAdmin(request)
    const rooms = await prisma.room.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        location: true,
        capacity: true,
        description: true,
        isActive: true,
      },
    })
    sendJson(response, 200, { rooms })
    return
  }

  if (pathname === '/api/admin/rooms' && method === 'POST') {
    await requireAdmin(request)
    const room = parseRoomInput(await readJson(request))
    try {
      const created = await prisma.room.create({ data: room })
      sendJson(response, 201, { room: created })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'Une salle utilise déjà ce code.')
      }
      throw error
    }
    return
  }

  const adminRoomRoute = pathname.match(/^\/api\/admin\/rooms\/([^/]+)$/)
  if (adminRoomRoute && method === 'PATCH') {
    await requireAdmin(request)
    const roomId = decodeURIComponent(adminRoomRoute[1])
    const body = await readJson(request)
    if (typeof body.isActive === 'boolean') {
      const result = await prisma.room.updateMany({
        where: { id: roomId },
        data: { isActive: body.isActive },
      })
      if (!result.count) {
        throw new HttpError(404, 'Cette salle est introuvable.')
      }
      sendJson(response, 200, { ok: true })
      return
    }

    const room = parseRoomInput(body)
    try {
      const updated = await prisma.room.update({ where: { id: roomId }, data: room })
      sendJson(response, 200, { room: updated })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'Une salle utilise déjà ce code.')
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new HttpError(404, 'Cette salle est introuvable.')
      }
      throw error
    }
    return
  }

  if (pathname === '/api/admin/unavailabilities' && method === 'GET') {
    await requireAdmin(request)
    const unavailabilities = await prisma.roomUnavailability.findMany({
      orderBy: { startAt: 'asc' },
      take: 500,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        reason: true,
        room: { select: { id: true, code: true, name: true } },
      },
    })
    sendJson(response, 200, { unavailabilities })
    return
  }

  if (pathname === '/api/admin/unavailabilities' && method === 'POST') {
    await requireAdmin(request)
    const body = await readJson(request)
    const roomId = requiredText(body, 'roomId', 'La salle', 64)
    const startAt = parseDate(body.startAt, 'Le début')
    const endAt = parseDate(body.endAt, 'La fin')
    const reason = requiredText(body, 'reason', 'Le motif d’indisponibilité', 300)
    if (endAt <= startAt) {
      throw new HttpError(400, 'La fin doit être postérieure au début.')
    }
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } })
    if (!room) {
      throw new HttpError(404, 'Cette salle est introuvable.')
    }
    const bookingConflict = await prisma.reservation.findFirst({
      where: {
        roomId,
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    })
    if (bookingConflict) {
      throw new HttpError(409, 'Une réservation occupe déjà une partie de ce créneau.')
    }
    const unavailability = await prisma.roomUnavailability.create({
      data: { roomId, startAt, endAt, reason },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        reason: true,
        room: { select: { id: true, code: true, name: true } },
      },
    })
    sendJson(response, 201, { unavailability })
    return
  }

  const adminUnavailabilityRoute = pathname.match(/^\/api\/admin\/unavailabilities\/([^/]+)$/)
  if (adminUnavailabilityRoute && method === 'DELETE') {
    await requireAdmin(request)
    const result = await prisma.roomUnavailability.deleteMany({
      where: { id: decodeURIComponent(adminUnavailabilityRoute[1]) },
    })
    if (!result.count) {
      throw new HttpError(404, 'Cette indisponibilité est introuvable.')
    }
    sendJson(response, 200, { ok: true })
    return
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    await requireAdmin(request)
    const users = await prisma.user.findMany({
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    })
    sendJson(response, 200, { users })
    return
  }

  const adminUserRoute = pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (adminUserRoute && method === 'PATCH') {
    const admin = await requireAdmin(request)
    const userId = decodeURIComponent(adminUserRoute[1])
    const role = (await readJson(request)).role
    if (role !== UserRole.STUDENT && role !== UserRole.TEACHER) {
      throw new HttpError(400, 'Le rôle demandé est invalide.')
    }
    if (userId === admin.id) {
      throw new HttpError(400, 'Vous ne pouvez pas modifier votre propre rôle.')
    }
    const result = await prisma.user.updateMany({
      where: { id: userId, role: { not: UserRole.ADMIN } },
      data: { role },
    })
    if (!result.count) {
      throw new HttpError(404, 'Cet utilisateur est introuvable ou administrateur.')
    }
    sendJson(response, 200, { ok: true })
    return
  }

  if (!pathname.startsWith('/api') && await serveFrontend(request, response, pathname)) {
    return
  }
  sendJson(response, 404, { error: 'Route introuvable.' })
}

export async function handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
  try {
    await handleRequest(request, response)
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, { error: error.message })
      return
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || (
        error.code === 'P2004' &&
        typeof error.meta?.database_error === 'string' &&
        error.meta.database_error.includes('Reservation_no_overlapping_active_room_reservations')
      ))
    ) {
      sendJson(response, 409, { error: 'Ce créneau vient d’être réservé. Choisissez-en un autre.' })
      return
    }

    console.error('SchoolRoom API request failed:', error)
    sendJson(response, 500, { error: 'Une erreur est survenue. Réessayez plus tard.' })
  }
}

export default handleHttpRequest

if (process.env.VERCEL !== '1') {
  const server = createServer((request, response) => {
    void handleHttpRequest(request, response)
  })

  server.listen(port, host, () => {
    console.log(`SchoolRoom backend listening at http://${host}:${port}`)
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => {
        void prisma.$disconnect().finally(() => process.exit(0))
      })
    })
  }
}
