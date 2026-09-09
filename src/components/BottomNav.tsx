import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { BagIcon, HostIcon, InboxIcon, SearchIcon, ShieldIcon } from "./Icons";

export function BottomNav() {
  const { user } = useAuth();
  const passportTo = user ? `/passport/${user.id}` : "/login";
  const inboxTo = user ? "/messages" : "/login?next=/messages";
  const unread = useQuery({
    queryKey: ["unread", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.unreadCount(),
    staleTime: 15_000,
  });
  const unreadCount = unread.data?.unread ?? 0;

  const items = [
    { to: "/explore", label: "Explore", icon: SearchIcon, live: true, badge: 0 },
    { to: "/trips", label: "Trips", icon: BagIcon, live: true, badge: 0 },
    { to: passportTo, label: "Passport", icon: ShieldIcon, live: true, badge: 0 },
    { to: inboxTo, label: "Inbox", icon: InboxIcon, live: true, badge: unreadCount },
    { to: "/host/listings", label: "Host", icon: HostIcon, live: true, badge: 0 },
  ] as const;

  return (
    <nav
      aria-label="Primary"
      className="sticky bottom-0 z-20 flex border-t border-[#EDE6D6] bg-paper px-2 pb-6 pt-2.5"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.label}
            to={item.to}
            className={({ isActive }) =>
              `relative flex flex-1 flex-col items-center gap-1 text-[10.5px] no-underline ${
                isActive ? "font-bold text-spruce" : "font-semibold text-ink/45"
              }`
            }
          >
            <span className="relative">
              <Icon />
              {item.badge > 0 ? (
                <span
                  data-testid="nav-unread"
                  className="absolute -right-2 -top-1 min-w-[16px] rounded-full bg-spruce px-1 text-center text-[9px] font-bold leading-[16px] text-paper"
                >
                  {item.badge > 9 ? "9+" : item.badge}
                </span>
              ) : null}
            </span>
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
