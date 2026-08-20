// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

// vi.hoisted ensures these mocks are available when the vi.mock factory runs
// (vi.mock calls are hoisted above imports by the Vitest transformer).
const {
  mockGetRouteContext,
  mockOpenAuthPopover,
  mockOauth2,
  mockResolveSole,
  mockHasAny,
  mockPublicSignupAllowed,
} = vi.hoisted(() => ({
  mockGetRouteContext: vi.fn(),
  mockOpenAuthPopover: vi.fn(),
  mockOauth2: vi.fn(),
  mockResolveSole: vi.fn((): string | null => null),
  mockHasAny: vi.fn((): boolean => false),
  mockPublicSignupAllowed: vi.fn((): boolean => false),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/' } }),
  useRouteContext: () => mockGetRouteContext(),
  Link: ({
    to,
    children,
    className,
    ...rest
  }: {
    to: string
    children: React.ReactNode
    className?: string
    [key: string]: unknown
  }) => (
    <a href={to} className={className} {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </a>
  ),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: mockOpenAuthPopover }),
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  hasAnyPortalAuthMethod: () => mockHasAny(),
  resolveSoleOidcProvider: () => mockResolveSole(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey?: readonly unknown[] }) =>
    queryKey?.[0] === 'settings' && queryKey?.[1] === 'portal-public-signup'
      ? { data: { allowPublicSignup: mockPublicSignupAllowed() } }
      : { data: null },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('@/lib/server/functions/chat', () => ({
  getMyConversationsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/public-signup-settings', () => ({
  getPublicSignupSettingFn: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: () => {},
}))

vi.mock('@/lib/client/auth-client', () => ({
  signOut: vi.fn(),
  authClient: { signIn: { oauth2: mockOauth2 } },
}))

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => null,
}))

vi.mock('@/components/shared/user-stats', () => ({
  UserStatsBar: () => null,
}))

import { PortalHeader } from '../portal-header'

const loggedInSession = {
  user: {
    id: 'usr_1',
    name: 'Test User',
    email: 'test@example.com',
    image: null,
    principalType: 'user',
  },
}

function renderHeader({
  userRole,
  isLoggedIn,
}: {
  userRole?: 'admin' | 'member' | 'user' | null
  isLoggedIn: boolean
}) {
  mockGetRouteContext.mockReturnValue({
    session: isLoggedIn ? loggedInSession : null,
    settings: {},
    registeredAuthProviders: [],
  })

  return render(
    <IntlProvider locale="en" defaultLocale="en">
      {/* showThemeToggle=false removes the theme dropdown trigger so the only
          remaining button is the avatar / user-dropdown trigger */}
      <PortalHeader orgName="Acme" userRole={userRole} showThemeToggle={false} />
    </IntlProvider>
  )
}

describe('PortalHeader — Admin dropdown item', () => {
  afterEach(() => cleanup())

  it('shows an Admin item in the user dropdown for team members', async () => {
    renderHeader({ userRole: 'admin', isLoggedIn: true })
    const trigger = screen.getByRole('button')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitem', { name: /admin/i })).toBeInTheDocument()
  })

  it('hides the Admin item for portal users', async () => {
    renderHeader({ userRole: 'user', isLoggedIn: true })
    const trigger = screen.getByRole('button')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    await screen.findByRole('menuitem', { name: /settings/i })
    expect(screen.queryByRole('menuitem', { name: /admin/i })).toBeNull()
  })
})

describe('PortalHeader — public signup policy', () => {
  beforeEach(() => {
    mockOpenAuthPopover.mockClear()
    mockOauth2.mockClear()
    mockHasAny.mockReturnValue(true)
    mockResolveSole.mockReturnValue(null)
    mockPublicSignupAllowed.mockReturnValue(false)
  })
  afterEach(() => cleanup())

  it('keeps Log in visible but hides Sign up when public signup is disabled', () => {
    renderHeader({ userRole: null, isLoggedIn: false })

    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign up/i })).toBeNull()
  })

  it('shows Sign up and opens signup mode when public signup is enabled', () => {
    mockPublicSignupAllowed.mockReturnValue(true)
    renderHeader({ userRole: null, isLoggedIn: false })

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    expect(mockOpenAuthPopover).toHaveBeenCalledWith(expect.objectContaining({ mode: 'signup' }))
  })
})

describe('PortalHeader — single-IdP redirect', () => {
  beforeEach(() => {
    mockOpenAuthPopover.mockClear()
    mockOauth2.mockClear()
    mockHasAny.mockReturnValue(true)
    mockResolveSole.mockReturnValue(null)
    mockPublicSignupAllowed.mockReturnValue(true)
  })
  afterEach(() => cleanup())

  it('redirects straight to the sole OIDC provider on Log in, skipping the dialog', () => {
    mockResolveSole.mockReturnValue('oidc_entra')
    renderHeader({ userRole: null, isLoggedIn: false })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(mockOauth2).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'oidc_entra' }))
    expect(mockOpenAuthPopover).not.toHaveBeenCalled()
  })

  it('opens the dialog on Log in when more than one method exists', () => {
    mockResolveSole.mockReturnValue(null)
    renderHeader({ userRole: null, isLoggedIn: false })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(mockOpenAuthPopover).toHaveBeenCalledWith(expect.objectContaining({ mode: 'login' }))
    expect(mockOauth2).not.toHaveBeenCalled()
  })
})
