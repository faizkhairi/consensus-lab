interface IconProps {
  readonly className?: string
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="currentColor">
      <path d="M6 4.2v11.6l9.5-5.8L6 4.2Z" />
    </svg>
  )
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="currentColor">
      <rect x="5" y="4" width="3.2" height="12" rx="0.6" />
      <rect x="11.8" y="4" width="3.2" height="12" rx="0.6" />
    </svg>
  )
}

export function StepBackIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="currentColor">
      <path d="M15.5 4.5v11l-7-5.5 7-5.5Z" />
      <rect x="4.8" y="4.5" width="2" height="11" rx="0.5" />
    </svg>
  )
}

export function StepIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="currentColor">
      <path d="M4.5 4.5v11l7-5.5-7-5.5Z" />
      <rect x="13.2" y="4.5" width="2" height="11" rx="0.5" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="none" stroke="currentColor">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CrossIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="none" stroke="currentColor">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
