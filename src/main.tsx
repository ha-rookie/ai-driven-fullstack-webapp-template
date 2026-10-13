import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WorkhubShowcase from "./reference/showcase/WorkhubShowcase";
import WorkhubNotFound from "./reference/workhub/WorkhubNotFound";
import { AuthProvider } from "./frontend/auth";
import "./workhub-business.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found");
}

// WORKHUB currently has only HOME and the administration entry route.
// Unknown routes must not silently render WORKHUB or load protected projections.
const path = window.location.pathname;
const isShowcase = path === "/showcase" || path === "/showcase/";
const isWorkhubEntry = path === "/" || path === "/index.html" || path === "/admin" || path === "/admin/";

createRoot(root).render(
  <StrictMode>
    {isShowcase
      ? <WorkhubShowcase />
      : isWorkhubEntry
        ? <AuthProvider><App /></AuthProvider>
        : <WorkhubNotFound />}
  </StrictMode>,
);
