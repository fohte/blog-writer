import { Button } from '@fohte/ui/button'
import { SettingsIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type AppHeaderProps = {
  status?: ReactNode
  onOpenSettings: () => void
}

export function AppHeader({ status, onOpenSettings }: AppHeaderProps) {
  return (
    <header className="flex min-h-12 flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-4 py-2">
      <span className="flex gap-1.5 font-mono text-sm font-bold">
        <span aria-hidden="true" className="text-primary">
          &gt;
        </span>
        blog-writer
      </span>
      <span className="flex-1" />
      {status}
      <Button
        aria-label="設定"
        onClick={onOpenSettings}
        size="icon"
        type="button"
        variant="outline"
      >
        <SettingsIcon />
      </Button>
    </header>
  )
}
