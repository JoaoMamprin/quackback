/**
 * In-place privacy wall for private portals.
 *
 * Renders a decorative blurred backdrop (purely fake chrome — no real portal
 * content ever reaches this component) with a centered card overlay.
 *
 * Two variants:
 *   - unauthenticated: the shared portal auth form, embedded directly as a
 *     dedicated sign-in screen (the same form public portals show in a dialog).
 *   - unauthorized: informational message, no form.
 *
 * After a successful sign-in the router is invalidated so the _portal loader
 * re-runs; if the visitor is now authorized, the real portal replaces this.
 */
import { useState, useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { toast } from 'sonner'
import {
  ArrowPathIcon,
  ChevronUpIcon,
  ChatBubbleLeftIcon,
  FireIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ListBulletIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { PortalAuthFormInline } from '@/components/auth/portal-auth-form-inline'
import { headerForStep } from '@/components/auth/auth-step-header'
import type { AuthFormStep } from '@/components/auth/email-signin-types'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { signOut } from '@/lib/client/auth-client'
import { isSafeCallbackUrl } from '@/lib/shared/routing'
import { navigateAfterAuth } from '@/lib/client/post-auth-navigation'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import type { PortalAccessGateError } from '@/lib/shared/types/portal-gate-error'
import { getPublicSignupSettingFn } from '@/lib/server/functions/public-signup-settings'

export type { PortalAccessGateError } from '@/lib/shared/types/portal-gate-error'

const MOCK_NAV = ['Feedback', 'Roadmap', 'Changelog']
const MOCK_SORTS = [
  { label: 'Trending', Icon: FireIcon },
  { label: 'Top', Icon: ArrowTrendingUpIcon },
  { label: 'New', Icon: ClockIcon },
]
const MOCK_BOARDS = [
  { name: 'All posts', count: 412 },
  { name: 'Feature Requests', count: 286 },
  { name: 'Bug Reports', count: 84 },
  { name: 'Integrations', count: 42 },
]
const MOCK_POSTS: Array<{
  title: string
  excerpt: string
  votes: number
  comments: number
  author: string
  when: string
  tags: string[]
  status?: { label: string; color: string }
}> = [
  { title: 'Dark mode for the dashboard', excerpt: 'A proper dark theme would make late-night sessions far easier on the eyes.', votes: 142, comments: 18, author: 'Alex M.', when: '2d', tags: ['ui', 'accessibility'], status: { label: 'Planned', color: '#f59e0b' } },
  { title: 'Bulk export to CSV', excerpt: 'Let admins export filtered results to a spreadsheet in one click.', votes: 97, comments: 11, author: 'Jordan P.', when: '4d', tags: ['export'], status: { label: 'In Progress', color: '#3b82f6' } },
  { title: 'Slack notifications for new replies', excerpt: 'Ping a channel whenever a teammate responds so nothing slips through.', votes: 73, comments: 6, author: 'Sam R.', when: '1w', tags: ['integrations'], status: { label: 'Under Review', color: '#8b5cf6' } },
  { title: 'Keyboard shortcuts for navigation', excerpt: 'Power users want to move between views without reaching for the mouse.', votes: 51, comments: 4, author: 'Riley K.', when: '1w', tags: ['ux'] },
  { title: 'Custom domains for portals', excerpt: 'Host the feedback portal on our own subdomain for a seamless brand.', votes: 44, comments: 9, author: 'Casey T.', when: '2w', tags: ['branding'], status: { label: 'Planned', color: '#f59e0b' } },
  { title: 'Mobile apps for iOS and Android', excerpt: 'Triage and reply to feedback on the go from a native app.', votes: 38, comments: 5, author: 'Morgan L.', when: '3w', tags: ['mobile'] },
]

function DecorativeBackdrop({ workspaceName, logoUrl }: { workspaceName: string; logoUrl: string | null }) {
  return (
    <div className="min-h-screen bg-background select-none pointer-events-none">
      <div className="w-full py-2 border-b border-border bg-background shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex h-12 items-center justify-between">
            <div className="flex items-center gap-2">
              {logoUrl ? <img src={logoUrl} alt="" className="h-8 w-8 rounded-md object-contain" /> : <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">{workspaceName.charAt(0).toUpperCase()}</div>}
              <span className="hidden max-w-[18ch] truncate font-semibold sm:block">{workspaceName}</span>
            </div>
            <div className="flex items-center gap-2"><div className="h-8 w-16 rounded-md bg-muted/50" /><div className="h-8 w-20 rounded-md bg-primary/80" /></div>
          </div>
          <div className="mt-2 flex items-center gap-1">
            {MOCK_NAV.map((label, i) => <div key={label} className={`rounded-md px-3 py-2 text-sm font-medium ${i === 0 ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>{label}</div>)}
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex gap-8">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="rounded-lg border border-border/40 bg-card p-4"><div className="flex h-9 items-center rounded-md border border-border/50 bg-muted/30 px-3 text-sm text-muted-foreground/50">Suggest a feature or report a bug…</div></div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1">{MOCK_SORTS.map(({ label, Icon }, i) => <div key={label} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${i === 0 ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}><Icon className={`h-4 w-4 ${i === 0 ? 'text-primary' : ''}`} />{label}</div>)}</div>
              <div className="flex items-center gap-2"><div className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground"><MagnifyingGlassIcon className="h-4 w-4" /><span className="hidden sm:inline">Search</span></div><div className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground"><FunnelIcon className="h-4 w-4" /><span className="hidden sm:inline">Filter</span></div></div>
            </div>
            <div className="space-y-3">
              {MOCK_POSTS.map((post) => <div key={post.title} className="flex items-start gap-4 rounded-lg border border-border/40 bg-card p-4"><div className="flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-border/50 bg-muted/40 py-2 text-muted-foreground"><ChevronUpIcon className="h-4 w-4" /><span className="text-sm font-semibold tabular-nums">{post.votes}</span></div><div className="min-w-0 flex-1">{post.status && <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: post.status.color }}><span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: post.status.color }} />{post.status.label}</div>}<div className="line-clamp-1 text-base font-semibold text-foreground">{post.title}</div><div className="mt-1 line-clamp-1 text-sm text-muted-foreground/60">{post.excerpt}</div><div className="mt-1.5 flex items-center gap-1">{post.tags.map((tag) => <span key={tag} className="inline-flex items-center rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">{tag}</span>)}</div><div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground"><span className="h-5 w-5 rounded-full bg-muted" /><span className="text-foreground/80">{post.author}</span><span className="text-muted-foreground/40">·</span><span className="text-muted-foreground/70">{post.when}</span><span className="ms-auto flex items-center gap-1 text-muted-foreground/50"><ChatBubbleLeftIcon className="h-3.5 w-3.5" />{post.comments}</span></div></div></div>)}
            </div>
          </div>
          <div className="hidden w-64 shrink-0 lg:block"><div className="overflow-hidden rounded-lg border border-border/50 bg-card shadow-sm"><div className="px-4 pb-3 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Boards</div><div className="space-y-1 px-4 pb-4">{MOCK_BOARDS.map((board, i) => <div key={board.name} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${i === 0 ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}>{i === 0 ? <ListBulletIcon className="h-4 w-4 text-primary" /> : <ChatBubbleLeftIcon className="h-4 w-4" />}<span className="truncate">{board.name}</span><span className="ms-auto text-[10px] font-semibold tabular-nums">{board.count}</span></div>)}</div></div></div>
        </div>
      </div>
    </div>
  )
}

interface GateCardProps {
  reason: 'unauthenticated' | 'unauthorized'
  workspaceName: string
  logoUrl: string | null
  authConfig: PortalAccessGateError['authConfig']
  userEmail?: string | null
  callbackUrl?: string
  autoOpenSignin?: 'login' | 'signup'
}

function GateCard({ reason, workspaceName, logoUrl, authConfig, userEmail, callbackUrl, autoOpenSignin }: GateCardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)
  const safeCallback = isSafeCallbackUrl(callbackUrl) ? callbackUrl : undefined
  const [mode, setMode] = useState<'login' | 'signup'>(autoOpenSignin ?? 'login')
  const [stepCtx, setStepCtx] = useState<{ step: AuthFormStep; email: string }>({ step: 'credentials', email: '' })
  const [signingIn, setSigningIn] = useState(false)

  const publicSignupQuery = useQuery({
    queryKey: ['settings', 'portal-public-signup'] as const,
    queryFn: () => getPublicSignupSettingFn(),
    enabled: reason === 'unauthenticated',
    staleTime: 30_000,
  })
  const publicSignupAllowed = publicSignupQuery.data?.allowPublicSignup ?? false
  const effectiveMode = publicSignupAllowed ? mode : 'login'

  const stepRef = useRef<AuthFormStep>('credentials')
  const signingInRef = useRef(false)
  useEffect(() => { stepRef.current = stepCtx.step }, [stepCtx.step])
  useEffect(() => { signingInRef.current = signingIn }, [signingIn])
  useEffect(() => () => {
    const step = stepRef.current
    const midTwoFactor = step === 'two-factor-enroll' || step === 'two-factor-challenge'
    if (midTwoFactor && !signingInRef.current) void signOut().catch(() => {})
  }, [])

  useAuthBroadcast({ onSuccess: () => {
    setSigningIn(true)
    if (safeCallback) navigateAfterAuth(safeCallback, () => { void router.invalidate().then(() => router.navigate({ to: safeCallback })) })
    else void router.invalidate()
  } })

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal', 'post'] }),
        queryClient.invalidateQueries({ queryKey: ['votedPosts'] }),
        router.invalidate(),
      ])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign out failed. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }

  const header = headerForStep(effectiveMode, stepCtx, { surface: 'private-portal', workspaceName })

  return (
    <div className="rounded-xl border bg-card shadow-lg p-8 w-full max-w-md text-center space-y-4">
      {logoUrl ? <img src={logoUrl} alt={workspaceName} className="mx-auto h-12 w-auto object-contain" /> : <div className="mx-auto flex h-12 w-12 items-center justify-center [border-radius:calc(var(--radius)*0.6)] bg-primary text-lg font-semibold text-primary-foreground">{workspaceName.charAt(0).toUpperCase()}</div>}
      {reason === 'unauthenticated' ? (
        signingIn ? <div className="flex h-9 items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite"><ArrowPathIcon className="h-4 w-4 animate-spin" aria-hidden="true" /><FormattedMessage id="portal.auth.signingIn" defaultMessage="Signing in..." /></div> : <><div><h1 className="text-xl font-semibold tracking-tight">{header.title}</h1><p className="mt-2 text-sm text-muted-foreground">{header.description}</p></div><div className="text-left"><PortalAuthFormInline mode={effectiveMode} authConfig={authConfig} workspaceName={workspaceName} callbackUrl={safeCallback} onModeSwitch={publicSignupAllowed ? setMode : undefined} onContextChange={setStepCtx} /></div></>
      ) : (
        <><div><h1 className="text-xl font-semibold tracking-tight">You don&apos;t have access</h1><p className="mt-2 text-sm text-muted-foreground">{userEmail ? <>You&apos;re signed in as <span className="font-medium text-foreground">{userEmail}</span>, but this account isn&apos;t on the access list for this private portal.</> : <>This portal is private and your account isn&apos;t on the access list.</>} Reach out to the {workspaceName} team to request access, or sign out and try a different account.</p></div><Button variant="outline" className="w-full" onClick={() => void handleSignOut()} disabled={signingOut}>{signingOut ? <ArrowPathIcon className="mr-2 h-3 w-3 animate-spin" /> : null}Sign out</Button></>
      )}
    </div>
  )
}

export interface PortalAccessGateProps extends Omit<GateCardProps, 'authConfig'>, Pick<PortalAccessGateError, 'authConfig' | 'themeStyles' | 'customCss' | 'userEmail' | 'locale'> {}

export function PortalAccessGate({ reason, workspaceName, logoUrl, authConfig, themeStyles, customCss, userEmail, locale, callbackUrl, autoOpenSignin }: PortalAccessGateProps) {
  return (
    <PortalIntlProvider locale={locale ?? DEFAULT_LOCALE}>
      <div className="relative min-h-screen">
        {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
        {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
        <div className="absolute inset-0 overflow-hidden blur-sm" aria-hidden data-testid="portal-gate-backdrop"><DecorativeBackdrop workspaceName={workspaceName} logoUrl={logoUrl} /></div>
        <div className="absolute inset-0 bg-background/40" aria-hidden />
        <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12"><GateCard reason={reason} workspaceName={workspaceName} logoUrl={logoUrl} authConfig={authConfig} userEmail={userEmail} callbackUrl={callbackUrl} autoOpenSignin={autoOpenSignin} /></div>
      </div>
    </PortalIntlProvider>
  )
}
