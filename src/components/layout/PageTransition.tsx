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
  return (
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
};

export default PageTransition;
