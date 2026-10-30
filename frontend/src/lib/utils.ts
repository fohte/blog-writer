import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Generated components import this helper through the utils alias in components.json.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
