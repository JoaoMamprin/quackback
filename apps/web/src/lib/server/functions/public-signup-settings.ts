import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

interface PortalAccessWithPublicSignup {
  allowPublicSignup?: boolean
}

export const getPublicSignupSettingFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getPortalConfig } = await import('@/lib/server/domains/settings/settings.service')
  const config = await getPortalConfig()
  const access = config.access as (typeof config.access & PortalAccessWithPublicSignup) | undefined

  return {
    allowPublicSignup: access?.allowPublicSignup !== false,
  }
})

const updatePublicSignupSettingSchema = z.object({
  allowPublicSignup: z.boolean(),
})

export const updatePublicSignupSettingFn = createServerFn({ method: 'POST' })
  .validator(updatePublicSignupSettingSchema.parse)
  .handler(async ({ data }) => {
    const [{ requireAuth }, { getPortalConfig, updatePortalConfig }] = await Promise.all([
      import('./auth-helpers'),
      import('@/lib/server/domains/settings/settings.service'),
    ])

    await requireAuth({ roles: ['admin'] })

    const before = await getPortalConfig()
    const beforeAccess = before.access as
      | (typeof before.access & PortalAccessWithPublicSignup)
      | undefined
    const beforeValue = beforeAccess?.allowPublicSignup !== false

    if (beforeValue === data.allowPublicSignup) {
      return { allowPublicSignup: beforeValue }
    }

    await updatePortalConfig(
      {
        access: { allowPublicSignup: data.allowPublicSignup },
      } as unknown as Parameters<typeof updatePortalConfig>[0]
    )

    return { allowPublicSignup: data.allowPublicSignup }
  })
