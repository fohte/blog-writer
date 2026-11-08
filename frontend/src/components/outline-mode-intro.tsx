export function OutlineModeIntro({ title }: { title: string }) {
  return (
    <header className="mb-5 flex flex-col gap-1.5">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-xs text-muted-foreground">
        見出しだけを表示しています。ここで書いた行は、そのまま本文の見出しになります。段落は畳まれているだけで消えません。
      </p>
    </header>
  )
}
