import { useEffect, useRef, useState } from "react";

/**
 * Custom hook to manage scroll-aware panel visibility:
 * - Scrolling down past 15px threshold hides panels.
 * - Scrolling up by 10px or near top (< 20px) reveals panels.
 */
export function useScrollDistractFree() {
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      // Always show panels near the top
      if (currentScrollY < 20) {
        setHidden(false);
        lastScrollY.current = currentScrollY;
        return;
      }

      const delta = currentScrollY - lastScrollY.current;

      // Scroll down threshold (> 15px)
      if (delta > 15) {
        setHidden(true);
        lastScrollY.current = currentScrollY;
      }
      // Scroll up threshold (< -10px)
      else if (delta < -10) {
        setHidden(false);
        lastScrollY.current = currentScrollY;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return hidden;
}
