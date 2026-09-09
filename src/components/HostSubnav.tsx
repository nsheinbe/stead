import { NavLink } from "react-router-dom";

const links = [
  { to: "/host/listings", label: "Homes" },
  { to: "/host/claims", label: "Claims" },
  { to: "/host/payouts", label: "Payouts" },
] as const;

export function HostSubnav() {
  return (
    <nav aria-label="Host" className="flex gap-4 text-sm font-semibold">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            `no-underline ${isActive ? "font-bold text-spruce" : "text-ink/55 hover:text-brass"}`
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
