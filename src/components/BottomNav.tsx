import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { loginHref } from "../lib/continuation";
import { BagIcon, HomeIcon, InboxIcon, SearchIcon, UserIcon } from "./Icons";

/**
 * Mobile-only member navigation: Explore, Stays, Messages, Profile, Homes.
 * Labels are always visible; the unread badge has a spoken equivalent. Hidden
 * on focused flows (sign-in, checkout, editing, a conversation) so it cannot
 * compete with the step's action.
 */
export function BottomNav() {
  const { user } = useAuth();
  const unread = useQuery({
    queryKey: ["unread", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.unreadCount(),
    staleTime: 15_000,
  });
  const unreadCount = unread.data?.unread ?? 0;

  const items = [
    { to: "/explore", label: "Explore", icon: SearchIcon, badge: 0 },
    { to: "/trips", label: "Stays", icon: BagIcon, badge: 0 },
    { to: "/messages", label: "Messages", icon: InboxIcon, badge: unreadCount },
    {
      to: user ? `/passport/${user.id}` : loginHref({ source: "mobile_nav" }),
      label: "Profile",
      icon: UserIcon,
      badge: 0,
    },
    { to: "/host/listings", label: "Homes", icon: HomeIcon, badge: 0 },
  ] as const;

  return (
    <nav
      aria-label="Member navigation"
      className="pb-safe sticky bottom-0 z-20 flex border-t border-divider bg-canvas/95 px-1 pt-1.5 backdrop-blur lg:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.label}
            to={item.to}
            className={({ isActive }) =>
              `relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-control text-[0.6875rem] font-semibold no-underline ${
                isActive ? "bg-surface-accent text-brand" : "text-ink-secondary hover:text-ink"
              }`
            }
          >
            <span className="relative">
              <Icon />
              {item.badge > 0 ? (
                <span
                  data-testid="nav-unread"
                  aria-hidden
                  className="money absolute -right-2.5 -top-1 min-w-[18px] rounded-full bg-brand px-1 text-center text-[0.625rem] font-bold leading-[18px] text-white"
                >
                  {item.badge > 9 ? "9+" : item.badge}
                </span>
              ) : null}
            </span>
            {item.label}
            {item.badge > 0 ? (
              <span className="sr-only">
                , {item.badge} unread {item.badge === 1 ? "message" : "messages"}
              </span>
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
