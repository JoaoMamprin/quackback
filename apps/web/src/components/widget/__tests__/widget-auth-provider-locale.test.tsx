// @vitest-environment happy-dom
/**
 * Regression coverage for issue #133 (React minified error #418).
 *
 * WidgetAuthProvider derived its initial locale from `navigator.language`
 * inside the useState initializer. The server has no `navigator`, so SSR
 * rendered the widget in DEFAULT_LOCALE while the client hydrated in the
 * visitor's browser language. The locale must come solely from the SSR-resolved
 * prop so hydration is stable whenever the browser locale differs from default.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIntl } from 'react-intl'

vi.mock('@/lib/client/widget-auth', () => ({
  setWidgetToken: vi.fn(),
  clearWidgetToken: vi.fn(),
  getWidgetToken: vi.fn(() => null),
  persistAnonymousToken: vi.fn(),
  readPersistedToken: vi.fn(() => null),
  clearPersistedToken: vi.fn(),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}))
vi.mock('@/lib/server/functions/widget', () => ({ createWidgetIdentifyTokenFn: vi.fn() }))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider } from '../widget-auth-provider'

function LocaleProbe() {
  return <span data-testid="locale">{useIntl().locale}</span>
}

function renderWidget(initialLocale?: 'en' | 'de' | 'fr' | 'ar' | 'pt') {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <WidgetAuthProvider initialLocale={initialLocale}>
        <LocaleProbe />
      </WidgetAuthProvider>
    </QueryClientProvider>
  )
}

describe('WidgetAuthProvider locale (hydration safety #133)', () => {
  beforeEach(() => {
    // A browser locale different from the application default triggers the
    // original hydration bug if navigator.language leaks into initial state.
    Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true })
  })

  it('uses the SSR-resolved initialLocale prop', () => {
    expect(renderWidget('de').getByTestId('locale').textContent).toBe('de')
  })

  it('falls back to Portuguese DEFAULT_LOCALE, never navigator.language', () => {
    expect(renderWidget().getByTestId('locale').textContent).toBe('pt')
  })

  it('owns its iframe document lang/dir (RTL for an RTL locale)', () => {
    // The widget is a separate document with a runtime-changeable locale, so it
    // sets its own <html lang>/dir rather than relying on the root document.
    renderWidget('ar')
    expect(document.documentElement.lang).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
    renderWidget('de')
    expect(document.documentElement.lang).toBe('de')
    expect(document.documentElement.dir).toBe('ltr')
  })
})
