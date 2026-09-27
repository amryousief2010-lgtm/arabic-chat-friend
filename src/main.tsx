import { createRoot } from "react-dom/client";
import { createElement } from "react";
import App from "./App.tsx";
import { checkAndReloadIfStale, CURRENT_VERSION } from "./lib/updateChecker.ts";
import { registerServiceWorker } from "./lib/registerSW.ts";
import "./index.css";

const rootEl = document.getElementById("root")!;
const root = createRoot(rootEl);

// Render first. A newer version.json must not leave the screen on the boot splash.
console.info(`[update] boot version: ${CURRENT_VERSION}`);
root.render(createElement(App));
registerServiceWorker();
void checkAndReloadIfStale("boot");
