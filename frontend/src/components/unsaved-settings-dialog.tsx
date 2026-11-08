import { Button } from '@fohte/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@fohte/ui/dialog'

type UnsavedSettingsDialogProps = {
  open: boolean
  onStay: () => void
  onLeave: () => void
}

export function UnsavedSettingsDialog({
  open,
  onStay,
  onLeave,
}: UnsavedSettingsDialogProps) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onStay()
      }}
      open={open}
    >
      <DialogContent showCloseButton={false}>
        <DialogTitle>未保存の変更があります</DialogTitle>
        <DialogDescription>
          保存せずに離れると、この変更は失われます。
        </DialogDescription>
        <DialogFooter>
          <Button onClick={onStay} size="sm" type="button" variant="outline">
            編集に戻る
          </Button>
          <Button onClick={onLeave} size="sm" type="button" variant="solid">
            保存せずに離れる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
