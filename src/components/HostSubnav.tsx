import { NavLink } from "react-router-dom";

const LINKS = [
  { to: "/host/listings", label: "Your homes" },
  { to: "/host/payouts", label: "Payouts" },
  { to: "/host/claims", label: "Claims" },
] as const;

/**
 * Hosting-tool tabs for narrow widths. On desktop the same links live in the
 * site header's hosting workspace, so the tabs are hidden there.
 */
export function HostSubnav() {
  return (
    <nav aria-label="Hosting tools" className="-mb-2 border-b border-divider lg:hidden">
      <ul className="m-0 flex list-none gap-5 overflow-x-auto p-0">
        {LINKS.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `inline-flex min-h-control items-center whitespace-nowrap border-b-2 text-sm font-semibold no-underline ${
                  isActive ? "border-brand text-brand" : "border-transparent text-ink-secondary hover:text-ink"
                }`
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
