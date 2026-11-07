import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { type SyntheticEvent, useEffect, useState } from 'react'

import type { Heading } from '#article/types'

type HeadingResearchAccessoryProps = {
  heading?: Heading | undefined
  busy?: boolean | undefined
  onResearch: (question: string) => void
}

export function HeadingResearchAccessory({
  heading,
  busy = false,
  onResearch,
}: HeadingResearchAccessoryProps) {
  const [question, setQuestion] = useState('')

  useEffect(() => {
    setQuestion('')
  }, [heading?.from, heading?.text])

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (heading && !busy) onResearch(question)
  }

  if (!heading)
    return (
      <p className="text-sm text-muted-foreground">
        見出しを選ぶと、その内容を調べられます。
      </p>
    )

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <label
        className="flex flex-col gap-2 text-sm font-medium"
        htmlFor={`research-question-${heading.from.toString()}`}
      >
        調べる問い
        <Input
          id={`research-question-${heading.from.toString()}`}
          onChange={(event) => {
            setQuestion(event.currentTarget.value)
          }}
          placeholder={heading.text}
          value={question}
        />
      </label>
      <Button disabled={busy} type="submit">
        この見出しについて調べる
      </Button>
    </form>
  )
}
