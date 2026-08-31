import { useEffect, useState } from "react";

/**
 * Custom hook to manage distract-free panel visibility:
 * 1. Focus input -> Hides panels for soft keyboard space.
 * 2. Background Tap:
 *    - Tapping background while typing: Blurs input and REAPPEARS panels.
 *    - Tapping background while reading/scrolling: TOGGLES fullscreen mode.
 */
export function useAutoDistractFree() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        setHidden(true);
      }
    };

    const handleFocusOut = () => {
      setTimeout(() => {
        const active = document.activeElement as HTMLElement | null;
        if (
          !active ||
          (active.tagName !== "INPUT" &&
            active.tagName !== "TEXTAREA" &&
            active.tagName !== "SELECT" &&
            !active.isContentEditable)
        ) {
          setHidden(false);
        }
      }, 100);
    };

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        !target.closest(
          "input, textarea, select, [contenteditable], button, a, [role='button']",
        )
      ) {
        const active = document.activeElement as HTMLElement | null;
        const isInputActive =
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.tagName === "SELECT" ||
            active.isContentEditable);

        if (isInputActive) {
          // Leaving an active input -> Blur and reveal panels
          active.blur();
          setHidden(false);
        } else {
          // Tapping background -> Toggle fullscreen mode
          setHidden((prev) => !prev);
        }
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  return hidden;
}
