import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * On a client-side route change, move focus to the page's main heading (or
 * to <main> when a page has none yet) and announce the new document title.
 *
 * Only a change of pathname counts: filter edits that rewrite the query
 * string, and in-page anchors, must not pull focus away from what the member
 * is doing. The entry key is compared rather than a "first run" flag so
 * StrictMode's doubled mount effect cannot mistake the initial load for a
 * navigation.
 */
export function RouteAnnouncer() {
  const { pathname, hash, key } = useLocation();
  const initialKey = useRef(key);
  const lastPathname = useRef(pathname);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (key === initialKey.current) return;
    if (pathname === lastPathname.current) return;
    lastPathname.current = pathname;
    if (hash) return;
    const frame = window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      const target = heading ?? document.getElementById("main");
      if (target) {
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
      window.scrollTo({ top: 0, left: 0 });
      setAnnouncement(document.title);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, hash, key]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}
