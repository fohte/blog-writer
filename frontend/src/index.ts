import { err, ok, type Result } from 'neverthrow'

export const greet = (name: string): Result<string, Error> => {
  if (!name) return err(new Error('name must not be empty'))
  return ok(`Hello, ${name}!`)
}
