import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Restores scroll position on navigation.
 *
 * React Router keeps the previous scroll offset when the route changes, so
 * clicking "How it works" from the footer lands you on the new page already
 * scrolled to the bottom — looking, reasonably, like a broken page.
 *
 * Also resolves hash links across routes. "Apply Now" on /how-it-works points at
 * /#get-started, which changes route *and* wants an anchor; the browser only
 * handles the anchor when the target is already in the document, which it isn't
 * until the home route has rendered.
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      // Wait a frame so the destination route has painted before we look for it.
      const id = hash.slice(1);
      requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            block: "start",
          });
          return;
        }
        window.scrollTo(0, 0);
      });
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
