type MobilePanelHeaderProps = {
  title: string
  closeLabel: string
  onClose: () => void
}

export function MobilePanelHeader({
  title,
  closeLabel,
  onClose,
}: MobilePanelHeaderProps) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4.5">
      <h2 className="flex-1 text-base font-bold">{title}</h2>
      <button className="h-11 px-3 text-sm" onClick={onClose} type="button">
        {closeLabel}
      </button>
    </header>
  )
}
