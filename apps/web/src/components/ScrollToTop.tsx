import { useEffect } from "react";
import { useLocation } from "react-router";

/** The prototype scrolled to the top on every screen change; routes need the same. */
export function ScrollToTop() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname, search]);
  return null;
}
