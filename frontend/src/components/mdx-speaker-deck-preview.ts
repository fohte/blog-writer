export interface MdxSpeakerDeckPreviewProps {
  id: string
  staticFrame?: boolean
}

export function createMdxSpeakerDeckPreview({
  id,
  staticFrame = false,
}: MdxSpeakerDeckPreviewProps): HTMLElement {
  const container = document.createElement('div')
  container.className = 'my-8'

  const frame = document.createElement('iframe')
  frame.className =
    'm-0 aspect-video h-auto w-full rounded-md border-0 bg-black/10 p-0 shadow-[0_5px_40px_rgb(0_0_0/0.2)]'
  frame.title = 'SpeakerDeck'
  frame.allowFullscreen = true
  frame.dataset['ratio'] = '1.7777777777777777'
  if (staticFrame) {
    frame.srcdoc =
      '<!doctype html><html><body style="margin:0;background:#111;color:#fff;display:grid;place-items:center;height:100vh;font:16px sans-serif">SpeakerDeck preview</body></html>'
  } else if (/^[A-Za-z0-9]+$/u.test(id)) {
    frame.src = `https://speakerdeck.com/player/${id}`
  }
  container.append(frame)
  return container
}
