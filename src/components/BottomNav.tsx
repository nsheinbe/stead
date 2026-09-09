import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { BagIcon, HostIcon, InboxIcon, SearchIcon, ShieldIcon } from "./Icons";

export function BottomNav() {
  const { user } = useAuth();
  const passportTo = user ? `/passport/${user.id}` : "/login";

  const items = [
    { to: "/explore", label: "Explore", icon: SearchIcon, live: true },
    { to: "/trips", label: "Trips", icon: BagIcon, live: true },
    { to: passportTo, label: "Passport", icon: ShieldIcon, live: true },
    { to: "/login", label: "Inbox", icon: InboxIcon, live: false },
    { to: "/host/listings", label: "Host", icon: HostIcon, live: true },
  ] as const;

  return (
    <nav
      aria-label="Primary"
      className="sticky bottom-0 z-20 flex border-t border-[#EDE6D6] bg-paper px-2 pb-6 pt-2.5"
    >
      {items.map((item) => {
        const Icon = item.icon;
        if (!item.live) {
          return (
            <span
              key={item.label}
              className="flex flex-1 flex-col items-center gap-1 text-[10.5px] font-semibold text-ink/45"
            >
              <Icon />
              {item.label}
            </span>
          );
        }
        return (
          <NavLink
            key={item.label}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 text-[10.5px] no-underline ${
                isActive ? "font-bold text-spruce" : "font-semibold text-ink/45"
              }`
            }
          >
            <Icon />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
