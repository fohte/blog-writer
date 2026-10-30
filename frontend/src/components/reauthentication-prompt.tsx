import { Button } from '@fohte/ui/button'
import { Panel } from '@fohte/ui/panel'

type ReauthenticationPromptProps = {
  onLoginAgain: () => void
}

export function ReauthenticationPrompt({
  onLoginAgain,
}: ReauthenticationPromptProps) {
  return (
    <Panel
      aria-live="assertive"
      className="flex flex-col items-start gap-3 rounded-lg p-4"
      role="alert"
    >
      <p>Cloudflare Access needs you to sign in again to resume syncing.</p>
      <Button onClick={onLoginAgain} type="button">
        Log in again
      </Button>
    </Panel>
  )
}
