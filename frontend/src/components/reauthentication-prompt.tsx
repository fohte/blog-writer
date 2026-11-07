import { Button } from '@fohte/ui/button'

type ReauthenticationPromptProps = {
  onLoginAgain: () => void
}

export function ReauthenticationPrompt({
  onLoginAgain,
}: ReauthenticationPromptProps) {
  return (
    <div
      aria-live="assertive"
      className="flex flex-col items-start gap-2 border border-foreground px-3 py-2.5 text-sm leading-relaxed"
      role="alert"
    >
      <p>
        <span aria-hidden="true" className="font-mono text-primary">
          !{' '}
        </span>
        ログインが切れました。編集は端末に保存され続けます。同期と LLM
        はログインすると再開します。
      </p>
      <Button onClick={onLoginAgain} size="sm" type="button" variant="solid">
        ログインし直す
      </Button>
    </div>
  )
}
