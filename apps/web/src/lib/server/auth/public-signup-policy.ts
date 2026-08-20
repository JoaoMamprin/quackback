import type { UserId } from '@quackback/ids'
import {
  account,
  and,
  db,
  eq,
  inArray,
  invitation,
  principal,
  session,
  user,
} from '@/lib/server/db'

const ACCOUNT_CREATION_DISABLED = 'ACCOUNT_CREATION_DISABLED'
const NEW_USER_WINDOW_MS = 30 * 1000

interface PortalAccessWithPublicSignup {
  allowPublicSignup?: boolean
}

type AuthUserSnapshot = Pick<
  typeof user.$inferSelect,
  | 'id'
  | 'name'
  | 'email'
  | 'emailVerified'
  | 'image'
  | 'imageKey'
  | 'createdAt'
  | 'updatedAt'
  | 'metadata'
  | 'locale'
  | 'country'
  | 'externalId'
  | 'isAnonymous'
  | 'twoFactorEnabled'
>

type PrincipalSnapshot = Pick<
  typeof principal.$inferSelect,
  'id' | 'role' | 'type' | 'displayName' | 'avatarUrl' | 'avatarKey'
>

export interface AuthActorSnapshot {
  user: AuthUserSnapshot
  principal: PrincipalSnapshot | null
  accountIds: Array<(typeof account.$inferSelect)['id']>
  sessionIds: Array<(typeof session.$inferSelect)['id']>
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function accountCreationDisabledResponse(): Response {
  return Response.json(
    {
      code: ACCOUNT_CREATION_DISABLED,
      message: 'Account creation is disabled for this workspace.',
    },
    { status: 403 }
  )
}

export async function isPublicSignupAllowed(): Promise<boolean> {
  const { getPortalConfig } = await import('@/lib/server/domains/settings/settings.service')
  const config = await getPortalConfig()
  const access = config.access as (typeof config.access & PortalAccessWithPublicSignup) | undefined
  return access?.allowPublicSignup !== false
}

async function hasActiveInvitation(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email)
  const invite = await db.query.invitation.findFirst({
    where: and(
      eq(invitation.email, normalized),
      inArray(invitation.kind, ['team', 'portal']),
      eq(invitation.status, 'pending')
    ),
    columns: { expiresAt: true },
  })

  return !!invite && invite.expiresAt.getTime() > Date.now()
}

async function hasExistingIdentifiedUser(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email)
  const existing = await db.query.user.findFirst({
    where: eq(user.email, normalized),
    columns: { id: true },
  })
  if (!existing) return false

  const existingPrincipal = await db.query.principal.findFirst({
    where: eq(principal.userId, existing.id),
    columns: { type: true },
  })

  return existingPrincipal?.type === 'user'
}

export async function isEmailAllowedForPublicAuth(email: string): Promise<boolean> {
  if (await isPublicSignupAllowed()) return true
  if (await hasExistingIdentifiedUser(email)) return true
  return hasActiveInvitation(email)
}

async function readRequestEmail(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type') ?? ''

  try {
    if (contentType.includes('application/json')) {
      const body = (await request.clone().json()) as Record<string, unknown>
      return typeof body.email === 'string' ? normalizeEmail(body.email) : null
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(await request.clone().text())
      const email = params.get('email')
      return email ? normalizeEmail(email) : null
    }
  } catch {
    // Let Better Auth return its normal validation response for malformed bodies.
  }

  return null
}

function isEmailBearingAccountCreationPath(pathname: string): boolean {
  return (
    pathname.endsWith('/sign-up/email') ||
    pathname.endsWith('/sign-in/magic-link') ||
    pathname.endsWith('/email-otp/send-verification-otp') ||
    pathname.endsWith('/sign-in/email-otp')
  )
}

export async function guardPublicAuthRequest(request: Request): Promise<Response | null> {
  if (await isPublicSignupAllowed()) return null

  const pathname = new URL(request.url).pathname
  if (!isEmailBearingAccountCreationPath(pathname)) return null

  const email = await readRequestEmail(request)
  if (!email) return null

  return (await isEmailAllowedForPublicAuth(email)) ? null : accountCreationDisabledResponse()
}

function isPostAuthPolicyPath(pathname: string, method: string): boolean {
  if (method === 'GET') {
    return (
      pathname.includes('/callback/') ||
      pathname.includes('/oauth2/callback/') ||
      pathname.endsWith('/magic-link/verify')
    )
  }

  if (method === 'POST') {
    return pathname.endsWith('/sign-in/social') || pathname.endsWith('/sign-up/email')
  }

  return false
}

export function needsPostAuthPublicSignupCheck(request: Request): boolean {
  return isPostAuthPolicyPath(new URL(request.url).pathname, request.method)
}

export async function captureAuthActorSnapshot(userId: string | null): Promise<AuthActorSnapshot | null> {
  if (!userId) return null

  const existingUser = await db.query.user.findFirst({
    where: eq(user.id, userId as UserId),
    columns: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      image: true,
      imageKey: true,
      createdAt: true,
      updatedAt: true,
      metadata: true,
      locale: true,
      country: true,
      externalId: true,
      isAnonymous: true,
      twoFactorEnabled: true,
    },
  })
  if (!existingUser) return null

  const [existingPrincipal, existingAccounts, existingSessions] = await Promise.all([
    db.query.principal.findFirst({
      where: eq(principal.userId, existingUser.id),
      columns: {
        id: true,
        role: true,
        type: true,
        displayName: true,
        avatarUrl: true,
        avatarKey: true,
      },
    }),
    db.query.account.findMany({
      where: eq(account.userId, existingUser.id),
      columns: { id: true },
    }),
    db.query.session.findMany({
      where: eq(session.userId, existingUser.id),
      columns: { id: true },
    }),
  ])

  return {
    user: existingUser,
    principal: existingPrincipal ?? null,
    accountIds: existingAccounts.map((row) => row.id),
    sessionIds: existingSessions.map((row) => row.id),
  }
}

function hasTaglyzeProvisioningMetadata(metadata: string | null): boolean {
  if (!metadata) return false
  try {
    const parsed = JSON.parse(metadata) as { taglyze?: unknown }
    return typeof parsed === 'object' && parsed !== null && !!parsed.taglyze
  } catch {
    return false
  }
}

async function rollbackAnonymousUpgrade(snapshot: AuthActorSnapshot): Promise<void> {
  await db.transaction(async (tx) => {
    const [currentAccounts, currentSessions] = await Promise.all([
      tx.select({ id: account.id }).from(account).where(eq(account.userId, snapshot.user.id)),
      tx.select({ id: session.id }).from(session).where(eq(session.userId, snapshot.user.id)),
    ])

    const previousAccountIds = new Set(snapshot.accountIds)
    for (const row of currentAccounts) {
      if (!previousAccountIds.has(row.id)) {
        await tx.delete(account).where(eq(account.id, row.id))
      }
    }

    const previousSessionIds = new Set(snapshot.sessionIds)
    for (const row of currentSessions) {
      if (!previousSessionIds.has(row.id)) {
        await tx.delete(session).where(eq(session.id, row.id))
      }
    }

    await tx
      .update(user)
      .set({
        name: snapshot.user.name,
        email: snapshot.user.email,
        emailVerified: snapshot.user.emailVerified,
        image: snapshot.user.image,
        imageKey: snapshot.user.imageKey,
        updatedAt: snapshot.user.updatedAt,
        metadata: snapshot.user.metadata,
        locale: snapshot.user.locale,
        country: snapshot.user.country,
        externalId: snapshot.user.externalId,
        isAnonymous: snapshot.user.isAnonymous,
        twoFactorEnabled: snapshot.user.twoFactorEnabled,
      })
      .where(eq(user.id, snapshot.user.id))

    if (snapshot.principal) {
      await tx
        .update(principal)
        .set({
          role: snapshot.principal.role,
          type: snapshot.principal.type,
          displayName: snapshot.principal.displayName,
          avatarUrl: snapshot.principal.avatarUrl,
          avatarKey: snapshot.principal.avatarKey,
        })
        .where(eq(principal.id, snapshot.principal.id))
    }
  })
}

export async function enforcePostAuthPublicSignupPolicy(input: {
  before: AuthActorSnapshot | null
  afterUserId: string | null
}): Promise<boolean> {
  if (!input.afterUserId || (await isPublicSignupAllowed())) return true

  const afterUser = await db.query.user.findFirst({
    where: eq(user.id, input.afterUserId as UserId),
    columns: {
      id: true,
      email: true,
      createdAt: true,
      metadata: true,
    },
  })
  if (!afterUser?.email) return true

  const afterPrincipal = await db.query.principal.findFirst({
    where: eq(principal.userId, afterUser.id),
    columns: { role: true, type: true },
  })
  if (!afterPrincipal) return true

  if (afterPrincipal.role === 'admin' || afterPrincipal.role === 'member') return true
  if (await hasActiveInvitation(afterUser.email)) return true
  if (hasTaglyzeProvisioningMetadata(afterUser.metadata ?? null)) return true

  if (
    input.before?.user.id === afterUser.id &&
    input.before.principal?.type === 'anonymous' &&
    afterPrincipal.type === 'user'
  ) {
    await rollbackAnonymousUpgrade(input.before)
    return false
  }

  if (input.before?.user.id === afterUser.id) return true

  const createdRecently = Date.now() - afterUser.createdAt.getTime() <= NEW_USER_WINDOW_MS
  if (!createdRecently) return true

  await db.delete(user).where(eq(user.id, afterUser.id))
  return false
}

function splitCookieHeader(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>()
  if (!cookieHeader) return cookies

  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    cookies.set(trimmed.slice(0, separator), trimmed.slice(separator + 1))
  }

  return cookies
}

export function requestHeadersWithResponseCookies(request: Request, response: Response): Headers {
  const cookies = splitCookieHeader(request.headers.get('cookie'))
  const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = responseHeaders.getSetCookie?.() ?? []
  const fallback = response.headers.get('set-cookie')
  const values = setCookies.length > 0 ? setCookies : fallback ? [fallback] : []

  for (const setCookie of values) {
    const pair = setCookie.split(';', 1)[0]
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  }

  const headers = new Headers(request.headers)
  if (cookies.size > 0) {
    headers.set(
      'cookie',
      Array.from(cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ')
    )
  }
  return headers
}
