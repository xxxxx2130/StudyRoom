import { useCallback, useEffect, useState, type FormEvent } from 'react'
import './App.css'

type Role = 'STUDENT' | 'TEACHER' | 'ADMIN'
type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED'
type User = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: Role
}
type Room = {
  id: string
  code: string
  name: string
  location: string
  capacity: number
  description: string | null
  isActive?: boolean
}
type Reservation = {
  id: string
  startAt: string
  endAt: string
  status: ReservationStatus
  purpose?: string
  room: { id?: string; code: string; name: string }
  user?: { firstName: string; lastName: string; email: string }
}
type AdminUser = User & { createdAt: string }
type Unavailability = {
  id: string
  startAt: string
  endAt: string
  reason: string
  room: { id: string; code: string; name: string }
}
type Page = 'availability' | 'reservations' | 'admin-calendar' | 'admin-management'
type AuthMode = 'login' | 'register'
type Theme = 'light' | 'dark'

function getSavedTheme(): Theme {
  return localStorage.getItem('schoolroom-theme-v2') === 'light' ? 'light' : 'dark'
}

function getSavedTextScale() {
  const savedScale = Number(localStorage.getItem('schoolroom-text-scale') ?? '1')
  return [1, 1.15, 1.3].includes(savedScale) ? savedScale : 1
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const responseText = await response.text()
  if (!responseText.trim()) {
    throw new Error(
      response.ok
        ? 'Le serveur a renvoyé une réponse vide.'
        : `Le serveur a renvoyé une réponse vide (HTTP ${response.status}).`,
    )
  }

  let data: unknown
  try {
    data = JSON.parse(responseText)
  } catch {
    throw new Error(`Le serveur a renvoyé une réponse invalide (HTTP ${response.status}).`)
  }

  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Une erreur est survenue. Réessayez.'
    throw new Error(message)
  }
  return data as T
}

function localDateInput(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

function weekStart(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  return monday
}

function getInitialBookingTimes() {
  const start = new Date(Date.now() + 60 * 60_000)
  start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0)
  return {
    startAt: localDateInput(start),
    endAt: localDateInput(new Date(start.getTime() + 60 * 60_000)),
  }
}

function formatDate(date: string | Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('fr-FR', options).format(new Date(date))
}

function formatTime(date: string | Date) {
  return formatDate(date, { hour: '2-digit', minute: '2-digit' })
}

function statusLabel(status: ReservationStatus) {
  return {
    PENDING: 'En attente',
    CONFIRMED: 'Confirmée',
    REJECTED: 'Refusée',
    CANCELLED: 'Annulée',
  }[status]
}

function App() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme)
  const [textScale, setTextScale] = useState(getSavedTextScale)
  const [user, setUser] = useState<User | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [page, setPage] = useState<Page>('availability')
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authRole, setAuthRole] = useState<Role>('STUDENT')
  const [authError, setAuthError] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [rooms, setRooms] = useState<Room[]>([])
  const [calendarReservations, setCalendarReservations] = useState<Reservation[]>([])
  const [myReservations, setMyReservations] = useState<Reservation[]>([])
  const [adminReservations, setAdminReservations] = useState<Reservation[]>([])
  const [adminRooms, setAdminRooms] = useState<Room[]>([])
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [adminUnavailabilities, setAdminUnavailabilities] = useState<Unavailability[]>([])
  const [week, setWeek] = useState(() => weekStart(new Date()))
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.setProperty('--text-scale', String(textScale))
    localStorage.setItem('schoolroom-theme-v2', theme)
    localStorage.setItem('schoolroom-text-scale', String(textScale))
  }, [theme, textScale])

  const refreshDashboard = useCallback(async (signal?: AbortSignal) => {
    if (!user) return
    setIsLoading(true)
    setDashboardError('')
    try {
      const [roomData, reservationData] = await Promise.all([
        api<{ rooms: Room[] }>('/api/rooms', { signal }),
        api<{ reservations: Reservation[] }>('/api/reservations', { signal }),
      ])
      setRooms(roomData.rooms)
      setMyReservations(reservationData.reservations)
      if (user.role === 'ADMIN') {
        const end = new Date(week)
        end.setDate(end.getDate() + 7)
        const [calendarData, reservationAdminData, roomAdminData, userAdminData, unavailableData] = await Promise.all([
          api<{ reservations: Reservation[] }>(
            `/api/calendar?start=${encodeURIComponent(week.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
            { signal },
          ),
          api<{ reservations: Reservation[] }>('/api/admin/reservations', { signal }),
          api<{ rooms: Room[] }>('/api/admin/rooms', { signal }),
          api<{ users: AdminUser[] }>('/api/admin/users', { signal }),
          api<{ unavailabilities: Unavailability[] }>('/api/admin/unavailabilities', { signal }),
        ])
        setCalendarReservations(calendarData.reservations)
        setAdminReservations(reservationAdminData.reservations)
        setAdminRooms(roomAdminData.rooms)
        setAdminUsers(userAdminData.users)
        setAdminUnavailabilities(unavailableData.unavailabilities)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setDashboardError(error instanceof Error ? error.message : 'Impossible de charger les données.')
      if (error instanceof Error && error.message.includes('Connectez-vous')) {
        setUser(null)
      }
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [user, week])

  useEffect(() => {
    let active = true
    api<{ user: User }>('/api/auth/session')
      .then(({ user: currentUser }) => {
        if (active) {
          setUser(currentUser)
          setPage(currentUser.role === 'ADMIN' ? 'admin-calendar' : 'availability')
        }
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setCheckingSession(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    void refreshDashboard(controller.signal)
    return () => controller.abort()
  }, [refreshDashboard, user])

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthError('')
    setAuthSubmitting(true)
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const response = await api<{ user: User }>(`/api/auth/${authMode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        body: JSON.stringify(values),
      })
      setUser(response.user)
      setPage(response.user.role === 'ADMIN' ? 'admin-calendar' : 'availability')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Connexion impossible.')
    } finally {
      setAuthSubmitting(false)
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' })
      setUser(null)
      setAdminReservations([])
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'La déconnexion a échoué.')
    }
  }

  async function changeReservationStatus(id: string, status: ReservationStatus) {
    try {
      await api(`/api/reservations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await refreshDashboard()
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'La réservation n’a pas pu être modifiée.')
    }
  }

  if (checkingSession) {
    return <main className="center-state"><p>Chargement de votre espace…</p></main>
  }

  if (!user) {
    return (
      <main className="auth-layout">
        <section className="auth-brand">
          <a className="brand" href="/" aria-label="SchoolRoom, l’espace EPSI">
            <span className="brand-mark" aria-hidden="true">SR</span>
            <span>School<span className="brand-light">Room</span></span>
          </a>
          <div className="auth-welcome">
            <h1 className="auth-epsi-title"><img src="/epsi-logo.svg" alt="EPSI" /></h1>
            <div className="auth-visual" aria-hidden="true">
              <div className="agenda-preview">
                <div className="agenda-top"><strong>Disponibilités</strong><span>Semaine</span></div>
                <div className="agenda-table">
                  <div className="agenda-times"><span>09</span><span>11</span><span>13</span><span>15</span></div>
                  <div className="agenda-day"><strong>Lun</strong><i /><i className="agenda-slot-one" /><i /></div>
                  <div className="agenda-day"><strong>Mar</strong><i className="agenda-slot-two" /><i /><i /></div>
                  <div className="agenda-day"><strong>Mer</strong><i /><i className="agenda-slot-three" /><i /></div>
                  <div className="agenda-day"><strong>Jeu</strong><i /><i /><i /></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-content">
          <form className="auth-form" onSubmit={handleAuth}>
            <p className="eyebrow">{authMode === 'login' ? 'Heureux de vous revoir' : 'Rejoignez SchoolRoom'}</p>
            <h2>{authMode === 'login' ? 'Connexion' : 'Créer mon compte'}</h2>
            <p className="form-intro">
              {authMode === 'login'
                ? 'Choisissez votre espace et entrez vos identifiants.'
                : 'Créez un compte étudiant ou enseignant. L’accès administration est réservé aux comptes autorisés.'}
            </p>
            <label>
              {authMode === 'login' ? 'Se connecter en tant que' : 'Créer un compte en tant que'}
              <select
                name="role"
                onChange={(event) => setAuthRole(event.target.value as Role)}
                value={authRole === 'ADMIN' && authMode === 'register' ? 'STUDENT' : authRole}
              >
                <option value="STUDENT">Étudiant</option>
                <option value="TEACHER">Enseignant</option>
                {authMode === 'login' && <option value="ADMIN">Administration</option>}
              </select>
            </label>
            {authMode === 'register' && (
              <div className="field-row">
                <label>Prénom<input autoComplete="given-name" maxLength={80} name="firstName" required /></label>
                <label>Nom<input autoComplete="family-name" maxLength={80} name="lastName" required /></label>
              </div>
            )}
            <label>Adresse e-mail<input autoComplete="email" maxLength={254} name="email" required type="email" /></label>
            <label>
              Mot de passe
              <input
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                minLength={authMode === 'register' ? 12 : undefined}
                maxLength={128}
                name="password"
                required
                type="password"
              />
              {authMode === 'register' && <small>12 caractères minimum</small>}
            </label>
            {authError && <p className="feedback error" role="alert">{authError}</p>}
            <button className="button button-primary wide-button" disabled={authSubmitting} type="submit">
              {authSubmitting ? 'Veuillez patienter…' : authMode === 'login' ? 'Se connecter' : 'Créer mon compte'}
              {!authSubmitting && <span aria-hidden="true">→</span>}
            </button>
            <p className="auth-switch">
              {authMode === 'login' ? 'Pas encore de compte ?' : 'Vous avez déjà un compte ?'}
              {' '}
              <button type="button" onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login')
                setAuthRole(authRole === 'ADMIN' ? 'STUDENT' : authRole)
                setAuthError('')
              }}>
                {authMode === 'login' ? 'Créer un compte' : 'Se connecter'}
              </button>
            </p>
          </form>
          <AccessibilityControls
            theme={theme}
            textScale={textScale}
            onThemeChange={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            onTextScaleChange={setTextScale}
          />
          </div>
        </section>
      </main>
    )
  }

  const currentWeekEnd = new Date(week)
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 6)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(week)
    date.setDate(date.getDate() + index)
    return date
  })

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#" aria-label="SchoolRoom, l’espace EPSI">
          <span className="brand-mark" aria-hidden="true">SR</span>
          <span>School<span className="brand-light">Room</span></span>
        </a>
        <nav className="app-nav" aria-label="Navigation principale">
          {user.role === 'ADMIN' ? (
            <>
              <button className={page === 'admin-calendar' ? 'active' : ''} onClick={() => setPage('admin-calendar')}>Agenda global</button>
              <button className={page === 'admin-management' ? 'active' : ''} onClick={() => setPage('admin-management')}>Gestion</button>
            </>
          ) : (
            <button className={page === 'availability' ? 'active' : ''} onClick={() => setPage('availability')}>Disponibilités</button>
          )}
          <button className={page === 'reservations' ? 'active' : ''} onClick={() => setPage('reservations')}>Mes réservations</button>
        </nav>
        <AccessibilityControls
          theme={theme}
          textScale={textScale}
          onThemeChange={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          onTextScaleChange={setTextScale}
        />
        <div className="account-menu">
          <span className="account-avatar" aria-hidden="true">{user.firstName[0]}{user.lastName[0]}</span>
          <span className="account-name">{user.firstName} {user.lastName}<small>{roleLabel(user.role)}</small></span>
          <button className="logout-button" onClick={() => void logout()}>Déconnexion</button>
        </div>
      </header>

      <main className="workspace">
        <div className="page-heading">
          <div>
            <h1>{page === 'admin-calendar' ? 'Agenda global des salles' : page === 'availability' ? 'Trouver une salle' : page === 'reservations' ? 'Mes réservations' : 'Gestion du campus'}</h1>
            <p>
              {page === 'admin-calendar'
                ? 'Réservations et indisponibilités de toutes les salles.'
                : page === 'availability'
                  ? 'Salles libres selon l’horaire et la capacité.'
                  : page === 'reservations'
                    ? 'Suivi de vos demandes et réservations.'
                    : 'Demandes, salles, comptes et indisponibilités.'}
            </p>
          </div>
          {page === 'availability' && (
            <button className="button button-primary" onClick={() => document.getElementById('booking-form')?.scrollIntoView({ behavior: 'smooth' })}>
              Réserver une salle <span aria-hidden="true">+</span>
            </button>
          )}
        </div>

        {dashboardError && <p className="feedback error dashboard-feedback" role="alert">{dashboardError}</p>}

        {page === 'admin-calendar' && user.role === 'ADMIN' && (
          <>
            <section className="calendar-panel">
              <div className="calendar-toolbar">
                <div>
                  <h2>{formatDate(week, { month: 'long', year: 'numeric' })}{week.getMonth() !== currentWeekEnd.getMonth() ? ` – ${formatDate(currentWeekEnd, { month: 'long', year: 'numeric' })}` : ''}</h2>
                  <p>Vue hebdomadaire · Les demandes en attente sont aussi visibles.</p>
                </div>
                <div className="calendar-controls">
                  <button aria-label="Semaine précédente" onClick={() => setWeek((current) => { const next = new Date(current); next.setDate(next.getDate() - 7); return next })}>←</button>
                  <button onClick={() => setWeek(weekStart(new Date()))}>Aujourd’hui</button>
                  <button aria-label="Semaine suivante" onClick={() => setWeek((current) => { const next = new Date(current); next.setDate(next.getDate() + 7); return next })}>→</button>
                </div>
              </div>
              <div className="calendar-grid">
                {days.map((day) => {
                  const events = calendarReservations.filter((reservation) => {
                    const dayStart = new Date(day)
                    const dayEnd = new Date(day)
                    dayEnd.setDate(dayEnd.getDate() + 1)
                    return new Date(reservation.startAt) < dayEnd && new Date(reservation.endAt) > dayStart
                  })
                  const isToday = new Date().toDateString() === day.toDateString()
                  return (
                    <section className={`calendar-day ${isToday ? 'today' : ''}`} key={day.toISOString()}>
                      <h3><span>{formatDate(day, { weekday: 'short' })}</span><strong>{formatDate(day, { day: 'numeric' })}</strong></h3>
                      <div className="day-events">
                        {events.map((event) => (
                          <article className={`calendar-event ${event.status === 'PENDING' ? 'pending' : ''}`} key={event.id}>
                            <strong>{event.room.code}</strong>
                            <span>{formatTime(event.startAt)}–{formatTime(event.endAt)}</span>
                            <small>{statusLabel(event.status)}</small>
                          </article>
                        ))}
                        {!events.length && <p className="empty-day">Aucun créneau réservé</p>}
                      </div>
                    </section>
                  )
                })}
              </div>
              {isLoading && <p className="loading-note">Mise à jour de l’agenda…</p>}
            </section>
          </>
        )}

        {page === 'availability' && user.role !== 'ADMIN' && (
          <>
            <section className="rooms-section">
              <div className="section-title"><div><h2>Salles du campus</h2></div></div>
              {rooms.length === 0 ? <p className="empty-state">Aucune salle active pour le moment.</p> : (
                <div className="room-grid">
                  {rooms.map((room) => (
                    <article className="room-card" key={room.id}>
                      <div className="room-card-top"><span className="room-code">{room.code}</span></div>
                      <h3>{room.name}</h3>
                      <p>{room.location}</p>
                      <div className="room-card-bottom"><span>{room.capacity} places</span><button onClick={() => document.getElementById('booking-form')?.scrollIntoView({ behavior: 'smooth' })}>Vérifier les disponibilités <span aria-hidden="true">→</span></button></div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <BookingForm onCreated={() => refreshDashboard()} />
          </>
        )}

        {page === 'reservations' && (
          <section className="content-panel">
            {myReservations.length === 0 ? <p className="empty-state">Vous n’avez encore aucune réservation.</p> : (
              <div className="reservation-list">
                {myReservations.map((reservation) => (
                  <article className="reservation-item" key={reservation.id}>
                    <div className="reservation-date"><strong>{formatDate(reservation.startAt, { day: '2-digit' })}</strong><span>{formatDate(reservation.startAt, { month: 'short' })}</span></div>
                    <div className="reservation-copy"><h3>{reservation.room.name}</h3><p>{formatDate(reservation.startAt, { weekday: 'long', day: 'numeric', month: 'long' })} · {formatTime(reservation.startAt)}–{formatTime(reservation.endAt)}</p><small>{reservation.purpose}</small></div>
                    <span className={`status-pill status-${reservation.status.toLowerCase()}`}>{statusLabel(reservation.status)}</span>
                    {(reservation.status === 'PENDING' || reservation.status === 'CONFIRMED') && new Date(reservation.startAt) > new Date() && (
                      <button className="text-button danger-text" onClick={() => void changeReservationStatus(reservation.id, 'CANCELLED')}>Annuler</button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {page === 'admin-management' && user.role === 'ADMIN' && (
          <AdminPanel
            reservations={adminReservations}
            rooms={adminRooms}
            users={adminUsers}
            unavailabilities={adminUnavailabilities}
            onRefresh={() => refreshDashboard()}
          />
        )}
      </main>
    </div>
  )
}

function AccessibilityControls({
  theme,
  textScale,
  onThemeChange,
  onTextScaleChange,
}: {
  theme: Theme
  textScale: number
  onThemeChange: () => void
  onTextScaleChange: (scale: number) => void
}) {
  const scales = [1, 1.15, 1.3]
  const scaleIndex = scales.indexOf(textScale)

  return (
    <div className="accessibility-controls" role="group" aria-label="Options d’accessibilité">
      <button
        aria-label={theme === 'light' ? 'Activer le mode sombre' : 'Activer le mode clair'}
        onClick={onThemeChange}
        type="button"
      >
        {theme === 'light' ? 'Mode sombre' : 'Mode clair'}
      </button>
      <div className="text-size-controls" role="group" aria-label="Taille du texte">
        <button
          aria-label="Réduire la taille du texte"
          disabled={scaleIndex <= 0}
          onClick={() => onTextScaleChange(scales[Math.max(0, scaleIndex - 1)])}
          type="button"
        >
          A−
        </button>
        <span aria-live="polite">{Math.round(textScale * 100)}%</span>
        <button
          aria-label="Augmenter la taille du texte"
          disabled={scaleIndex >= scales.length - 1}
          onClick={() => onTextScaleChange(scales[Math.min(scales.length - 1, scaleIndex + 1)])}
          type="button"
        >
          A+
        </button>
      </div>
    </div>
  )
}

function roleLabel(role: Role) {
  return { STUDENT: 'Étudiant', TEACHER: 'Enseignant', ADMIN: 'Administrateur' }[role]
}

function BookingForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const initialTimes = getInitialBookingTimes()
  const [startAt, setStartAt] = useState(initialTimes.startAt)
  const [endAt, setEndAt] = useState(initialTimes.endAt)
  const [capacity, setCapacity] = useState('1')
  const [availableRooms, setAvailableRooms] = useState<Room[]>([])
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function clearAvailability() {
    setAvailableRooms([])
    setSelectedRoomId('')
    setHasSearched(false)
    setError('')
  }

  async function searchAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setSearching(true)
    setSelectedRoomId('')
    try {
      const query = new URLSearchParams({
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        capacity,
      })
      const result = await api<{ rooms: Room[] }>(`/api/availability?${query}`)
      setAvailableRooms(result.rooms)
      setHasSearched(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Les disponibilités n’ont pas pu être chargées.')
    } finally {
      setSearching(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    setSuccess('')
    setSubmitting(true)
    const values = Object.fromEntries(new FormData(form))
    const selectedRoom = availableRooms.find((room) => room.id === selectedRoomId)
    if (!selectedRoom) {
      setError('Recherchez les disponibilités et choisissez une salle avant de réserver.')
      setSubmitting(false)
      return
    }

    try {
      await api('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          roomId: selectedRoomId,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
        }),
      })
      setSuccess(
        `Votre réservation de ${selectedRoom.name} (${selectedRoom.code}), le ${formatDate(startAt, { dateStyle: 'long' })} de ${formatTime(startAt)} à ${formatTime(endAt)}, est confirmée automatiquement.`,
      )
      form.reset()
      clearAvailability()
      await onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La réservation n’a pas pu être envoyée.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="booking-section" id="booking-form">
      <div className="booking-copy">
        <h2>Faire une demande</h2>
        <p>Choisissez un créneau, puis une salle disponible.</p>
      </div>
      <div className="booking-flow">
        <form className="booking-form" onSubmit={searchAvailability}>
          <h3>1. Rechercher une salle libre</h3>
          <div className="field-row">
            <label>
              Début
              <input
                min={localDateInput(new Date())}
                onChange={(event) => { setStartAt(event.target.value); clearAvailability() }}
                required
                type="datetime-local"
                value={startAt}
              />
            </label>
            <label>
              Fin
              <input
                min={startAt}
                onChange={(event) => { setEndAt(event.target.value); clearAvailability() }}
                required
                type="datetime-local"
                value={endAt}
              />
            </label>
          </div>
          <label>
            Capacité minimale
            <input
              min={1}
              max={500}
              onChange={(event) => { setCapacity(event.target.value); clearAvailability() }}
              required
              type="number"
              value={capacity}
            />
          </label>
          {error && <p className="feedback error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={searching} type="submit">
            {searching ? 'Recherche…' : 'Voir les salles libres'} <span aria-hidden="true">→</span>
          </button>
        </form>

        {hasSearched && (
          <section className="availability-results" aria-live="polite" aria-atomic="true">
            <h3>2. Choisissez une salle</h3>
            {availableRooms.length === 0 ? (
              <p className="empty-state">Aucune salle libre ne correspond à cette date, cet horaire et cette capacité. Essayez un autre créneau.</p>
            ) : (
              <div className="available-room-list">
                {availableRooms.map((room) => (
                  <button
                    aria-pressed={selectedRoomId === room.id}
                    className={`available-room ${selectedRoomId === room.id ? 'selected' : ''}`}
                    key={room.id}
                    onClick={() => setSelectedRoomId(room.id)}
                    type="button"
                  >
                    <span><strong>{room.code} · {room.name}</strong><small>{room.location} · {room.capacity} places</small></span>
                    <span className="room-state">Libre</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {selectedRoomId && (
          <form className="booking-form" onSubmit={submit}>
            <h3>3. Confirmer votre demande</h3>
            <p className="selected-slot">
              {availableRooms.find((room) => room.id === selectedRoomId)?.name} · {formatDate(startAt, { dateStyle: 'long' })} · {formatTime(startAt)}–{formatTime(endAt)}
            </p>
            <label>
              Motif
              <textarea maxLength={500} name="purpose" placeholder="Ex. Révision en groupe, projet…" required rows={3} />
            </label>
            {error && <p className="feedback error" role="alert">{error}</p>}
            <button className="button button-primary" disabled={submitting} type="submit">
              {submitting ? 'Envoi…' : 'Envoyer la demande'} <span aria-hidden="true">→</span>
            </button>
          </form>
        )}
        {success && <p className="feedback success" role="status">{success}</p>}
      </div>
    </section>
  )
}

function AdminPanel({
  reservations,
  rooms,
  users,
  unavailabilities,
  onRefresh,
}: {
  reservations: Reservation[]
  rooms: Room[]
  users: AdminUser[]
  unavailabilities: Unavailability[]
  onRefresh: () => Promise<void>
}) {
  const [section, setSection] = useState<'requests' | 'rooms' | 'availability' | 'users'>('requests')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState('')

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await action()
      setMessage(successMessage)
      await onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'L’action n’a pas pu être effectuée.')
    } finally {
      setBusy(false)
    }
  }

  async function addRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    await runAction(async () => {
      await api('/api/admin/rooms', {
        method: 'POST',
        body: JSON.stringify({ ...values, capacity: Number(values.capacity) }),
      })
      form.reset()
    }, 'La salle a été ajoutée.')
  }

  async function updateRoom(event: FormEvent<HTMLFormElement>, roomId: string) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    await runAction(async () => {
      await api(`/api/admin/rooms/${encodeURIComponent(roomId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...values, capacity: Number(values.capacity) }),
      })
      setEditingRoomId('')
    }, 'La salle a été modifiée.')
  }

  async function addUnavailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    await runAction(async () => {
      await api('/api/admin/unavailabilities', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          startAt: new Date(String(values.startAt)).toISOString(),
          endAt: new Date(String(values.endAt)).toISOString(),
        }),
      })
      form.reset()
    }, 'L’indisponibilité a été ajoutée à l’agenda.')
  }

  return (
    <section className="admin-area">
      <div className="admin-tabs" role="group" aria-label="Sections d’administration">
        <button aria-pressed={section === 'requests'} className={section === 'requests' ? 'selected' : ''} onClick={() => setSection('requests')}>Demandes <span>{reservations.filter((item) => item.status === 'PENDING').length}</span></button>
        <button aria-pressed={section === 'rooms'} className={section === 'rooms' ? 'selected' : ''} onClick={() => setSection('rooms')}>Salles <span>{rooms.length}</span></button>
        <button aria-pressed={section === 'availability'} className={section === 'availability' ? 'selected' : ''} onClick={() => setSection('availability')}>Disponibilités <span>{unavailabilities.length}</span></button>
        <button aria-pressed={section === 'users'} className={section === 'users' ? 'selected' : ''} onClick={() => setSection('users')}>Utilisateurs <span>{users.length}</span></button>
      </div>
      {error && <p className="feedback error" role="alert">{error}</p>}
      {message && <p className="feedback success" role="status">{message}</p>}

      {section === 'requests' && (
        <div className="content-panel">
          {reservations.length === 0 ? <p className="empty-state">Aucune demande pour le moment.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Demandeur</th><th>Salle</th><th>Créneau</th><th>Motif</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>{reservations.map((reservation) => (
                <tr key={reservation.id}>
                  <td><strong>{reservation.user?.firstName} {reservation.user?.lastName}</strong><small>{reservation.user?.email}</small></td>
                  <td>{reservation.room.code}</td>
                  <td>{formatDate(reservation.startAt, { day: 'numeric', month: 'short' })}<small>{formatTime(reservation.startAt)}–{formatTime(reservation.endAt)}</small></td>
                  <td>{reservation.purpose}</td>
                  <td><span className={`status-pill status-${reservation.status.toLowerCase()}`}>{statusLabel(reservation.status)}</span></td>
                  <td className="table-actions">{reservation.status === 'PENDING' && <><button disabled={busy} onClick={() => void runAction(() => api(`/api/reservations/${reservation.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CONFIRMED' }) }), 'Réservation confirmée.')}>Confirmer</button><button className="danger-text" disabled={busy} onClick={() => void runAction(() => api(`/api/reservations/${reservation.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'REJECTED' }) }), 'Demande refusée.')}>Refuser</button></>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {section === 'rooms' && (
        <div className="admin-columns">
          <div className="content-panel">
            <h2>Salles du campus</h2>
            {rooms.map((room) => (
              <article className="admin-room-row" key={room.id}>
                {editingRoomId === room.id ? (
                  <form className="room-edit-form" onSubmit={(event) => void updateRoom(event, room.id)}>
                    <label>Code<input defaultValue={room.code} maxLength={20} name="code" required /></label>
                    <label>Nom<input defaultValue={room.name} maxLength={120} name="name" required /></label>
                    <label>Emplacement<input defaultValue={room.location} maxLength={120} name="location" required /></label>
                    <label>Capacité<input defaultValue={room.capacity} min={1} max={500} name="capacity" required type="number" /></label>
                    <label>Description<textarea defaultValue={room.description ?? ''} maxLength={500} name="description" rows={2} /></label>
                    <div><button className="button button-primary" disabled={busy} type="submit">Enregistrer</button><button className="text-button" disabled={busy} onClick={() => setEditingRoomId('')} type="button">Annuler</button></div>
                  </form>
                ) : (
                  <>
                    <div><strong>{room.code} · {room.name}</strong><small>{room.location} · {room.capacity} places</small></div>
                    <div>
                      <span className={`room-state ${room.isActive ? '' : 'inactive'}`}>{room.isActive ? 'Active' : 'Désactivée'}</span>
                      <button className="text-button" disabled={busy} onClick={() => setEditingRoomId(room.id)}>Modifier</button>
                      <button className="text-button" disabled={busy} onClick={() => void runAction(() => api(`/api/admin/rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !room.isActive }) }), room.isActive ? 'Salle désactivée.' : 'Salle activée.')}>{room.isActive ? 'Désactiver' : 'Activer'}</button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
          <form className="content-panel room-create-form" onSubmit={addRoom}>
            <h2>Ajouter une salle</h2>
            <label>Code<input maxLength={20} name="code" placeholder="A-101" required /></label>
            <label>Nom<input maxLength={120} name="name" required /></label>
            <label>Emplacement<input maxLength={120} name="location" required /></label>
            <label>Capacité<input min={1} max={500} name="capacity" required type="number" /></label>
            <label>Description<textarea maxLength={500} name="description" rows={3} /></label>
            <button className="button button-primary" disabled={busy} type="submit">Ajouter la salle <span aria-hidden="true">→</span></button>
          </form>
        </div>
      )}

      {section === 'availability' && (
        <div className="admin-columns">
          <form className="content-panel room-create-form" onSubmit={addUnavailability}>
            <h2>Bloquer un créneau</h2>
            <p className="form-intro">Ajoutez une indisponibilité pour une maintenance, un cours ou un événement. Les réservations déjà confirmées restent prioritaires.</p>
            <label>Salle<select name="roomId" required>{rooms.filter((room) => room.isActive).map((room) => <option key={room.id} value={room.id}>{room.code} — {room.name}</option>)}</select></label>
            <div className="field-row">
              <label>Début<input min={localDateInput(new Date())} name="startAt" required type="datetime-local" /></label>
              <label>Fin<input min={localDateInput(new Date())} name="endAt" required type="datetime-local" /></label>
            </div>
            <label>Motif<input maxLength={300} name="reason" placeholder="Ex. Maintenance" required /></label>
            <button className="button button-primary" disabled={busy || !rooms.some((room) => room.isActive)} type="submit">Bloquer le créneau <span aria-hidden="true">→</span></button>
          </form>
          <div className="content-panel">
            <h2>Créneaux bloqués</h2>
            {unavailabilities.length === 0 ? <p className="empty-state">Aucun créneau d’indisponibilité.</p> : unavailabilities.map((item) => (
              <article className="admin-room-row" key={item.id}>
                <div>
                  <strong>{item.room.code} · {item.room.name}</strong>
                  <small>{formatDate(item.startAt, { dateStyle: 'medium' })} · {formatTime(item.startAt)}–{formatTime(item.endAt)} · {item.reason}</small>
                </div>
                <button className="text-button danger-text" disabled={busy} onClick={() => void runAction(() => api(`/api/admin/unavailabilities/${encodeURIComponent(item.id)}`, { method: 'DELETE' }), 'Le créneau a été débloqué.')}>Supprimer</button>
              </article>
            ))}
          </div>
        </div>
      )}

      {section === 'users' && (
        <div className="content-panel">
          <div className="table-wrap"><table>
            <thead><tr><th>Utilisateur</th><th>Inscription</th><th>Rôle</th></tr></thead>
            <tbody>{users.map((person) => (
              <tr key={person.id}>
                <td><strong>{person.firstName} {person.lastName}</strong><small>{person.email}</small></td>
                <td>{formatDate(person.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</td>
                <td>{person.role === 'ADMIN' ? <span className="role-label">Administrateur</span> : (
                  <select aria-label={`Rôle de ${person.firstName} ${person.lastName}`} disabled={busy} onChange={(event) => void runAction(() => api(`/api/admin/users/${person.id}`, { method: 'PATCH', body: JSON.stringify({ role: event.target.value }) }), 'Rôle mis à jour.')} value={person.role}>
                    <option value="STUDENT">Étudiant</option><option value="TEACHER">Enseignant</option>
                  </select>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </section>
  )
}

export default App
