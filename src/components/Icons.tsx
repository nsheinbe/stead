export function SearchIcon({ className = "h-[22px] w-[22px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M16.5 16.5 L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function BagIcon({ className = "h-[22px] w-[22px]" }: { className?: string }) {
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

export function ShieldIcon({ className = "h-[22px] w-[22px]" }: { className?: string }) {
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

export function InboxIcon({ className = "h-[22px] w-[22px]" }: { className?: string }) {
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

export function HostIcon({ className = "h-[22px] w-[22px]" }: { className?: string }) {
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

export function BoltIcon() {
  return (
    <svg width="9" height="11" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M11 1 L3 11.5 H9 L8 19 L17 8 H10.5 Z" fill="#B58B3E" />
    </svg>
  );
}

export function ReturnArrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M17 5 V11 C17 12.7 15.7 14 14 14 H4 M7 10.5 L3.5 14 L7 17.5"
        stroke="#8C6A2C"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BackChevron() {
  return (
    <svg width="9" height="15" viewBox="0 0 12 20" fill="none" aria-hidden>
      <path
        d="M10 2 L2 10 L10 18"
        stroke="#17201B"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ScaleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 2 V4 M4 4.5 L10 4 L16 4.5 M4 4.5 L2 10 H6 Z M16 4.5 L14 10 H18 Z M10 4 V16 M6.5 16 H13.5"
        stroke="#B58B3E"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
