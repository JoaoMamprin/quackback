import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { updatePublicSignupSettingFn } from '@/lib/server/functions/public-signup-settings'

interface PublicSignupSettingCardProps {
  initialEnabled: boolean
}

export function PublicSignupSettingCard({ initialEnabled }: PublicSignupSettingCardProps) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)

  async function handleChange(next: boolean) {
    if (saving || next === enabled) return

    const previous = enabled
    setEnabled(next)
    setSaving(true)

    try {
      await updatePublicSignupSettingFn({
        data: { allowPublicSignup: next },
      })
      await router.invalidate()
    } catch {
      setEnabled(previous)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      title="Public account registration"
      description="Control whether portal visitors can create their own identified accounts."
      action={
        <Switch
          id="public-signup-toggle"
          checked={enabled}
          onCheckedChange={(checked) => void handleChange(checked)}
          disabled={saving}
          aria-label="Allow public account registration"
        />
      }
    >
      <p className="text-xs text-muted-foreground">
        {enabled
          ? 'Visitors may create accounts using the sign-in methods enabled for the portal.'
          : 'Existing users can still sign in. Anonymous portal access and voting are unchanged, and trusted provisioning such as Taglyze SSO remains available.'}
      </p>
    </SettingsCard>
  )
}
