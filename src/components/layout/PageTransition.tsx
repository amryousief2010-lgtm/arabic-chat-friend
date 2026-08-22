import { motion, type Transition, type Variants } from "framer-motion";
import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import DashboardLayout from "./DashboardLayout";

interface PageTransitionProps {
  children: ReactNode;
}

// Routes rendered without the app shell (no sidebar / bottom nav)
const CHROMELESS_ROUTES = ["/auth", "/trust", "/install", "/unauthorized"];


const pageVariants: Variants = {
  initial: {
    opacity: 0,
    y: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
    y: -8,
  },
};

const pageTransition: Transition = {
  type: "tween",
  ease: [0.4, 0, 0.2, 1],
  duration: 0.2,
};

const PageTransition = ({ children }: PageTransitionProps) => {
  const { pathname } = useLocation();
  const isChromeless =
    CHROMELESS_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("embed") === "1");

  const content = (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={pageVariants}
      transition={pageTransition}
    >
      {children}
    </motion.div>
  );

  if (isChromeless) return content;

  return <DashboardLayout>{content}</DashboardLayout>;
};


export default PageTransition;
