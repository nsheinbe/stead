/**
 * Line icons, 1.8px strokes, coloured by `currentColor`. All are decorative:
 * the text beside them carries the meaning.
 */
type IconProps = { className?: string };

const DEFAULT = "h-[22px] w-[22px]";

export function SearchIcon({ className = DEFAULT }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16.5 16.5 L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function BagIcon({ className = DEFAULT }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="7.5" width="16" height="12.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M9 7.5 V5 C9 4.2 9.7 3.5 10.5 3.5 H13.5 C14.3 3.5 15 4.2 15 5 V7.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function ShieldIcon({ className = DEFAULT }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.5 L20 5.5 V11 C20 16.5 16.5 20 12 21.5 C7.5 20 4 16.5 4 11 V5.5 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 11.5 L11 14 L15.5 8.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InboxIcon({ className = DEFAULT }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 5.5 H19.5 V16.5 H12.5 L8.5 20 V16.5 H4.5 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Key: the hosting workspace. */
export function HostIcon({ className = DEFAULT }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M11.2 11.2 L20 20 M16.8 16.8 L19.3 14.3 M13.8 13.8 L15.8 11.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** House: "Your homes". */
export function HomeIcon({ className = DEFAULT }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 10.6 L12 3.4 L20.5 10.6 V20.5 H3.5 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.5 20.5 V14.5 H14.5 V20.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function UserIcon({ className = DEFAULT }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8.5" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M4.5 20.5 C4.5 16.6 7.9 14.5 12 14.5 C16.1 14.5 19.5 16.6 19.5 20.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MenuIcon({ className = DEFAULT }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ className = DEFAULT }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9 L12 15 L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BoltIcon({ className = "h-[11px] w-[9px]" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M11 1 L3 11.5 H9 L8 19 L17 8 H10.5 Z" fill="currentColor" />
    </svg>
  );
}

export function ReturnArrow({ className = "h-3 w-3" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M17 5 V11 C17 12.7 15.7 14 14 14 H4 M7 10.5 L3.5 14 L7 17.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BackChevron({ className = "h-[15px] w-[9px]" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 12 20" fill="none" aria-hidden>
      <path
        d="M10 2 L2 10 L10 18"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ScaleIcon({ className = "h-[15px] w-[15px]" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 2 V4 M4 4.5 L10 4 L16 4.5 M4 4.5 L2 10 H6 Z M16 4.5 L14 10 H18 Z M10 4 V16 M6.5 16 H13.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
