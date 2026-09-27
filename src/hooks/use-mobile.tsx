import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function readIsMobile() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  // Seed from the viewport so the first paint picks one layout. Starting at
  // undefined used to render the desktop tree (including the hidden orders
  // table) on phones until the effect ran.
  const [isMobile, setIsMobile] = React.useState(readIsMobile);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
