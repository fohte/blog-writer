export function OfflineBanner() {
  return (
    <div
      className="flex flex-wrap gap-2 border-b border-border bg-card px-4 py-2.5 text-sm text-muted-foreground-strong"
      role="status"
    >
      <span className="text-foreground">オフラインです。</span>
      <span>
        すべての記事を開いて編集できます。変更は端末に保存され、つながったら同期します。LLM
        はつながってから使えます。
      </span>
    </div>
  )
}
