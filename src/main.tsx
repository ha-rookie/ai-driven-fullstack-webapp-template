import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WorkhubShowcase from "./reference/showcase/WorkhubShowcase";
import ReferenceSite from "./reference/site/ReferenceSite";
import WorkhubNotFound from "./reference/workhub/WorkhubNotFound";
import { AuthProvider } from "./frontend/auth";
import "./workhub-business.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found");
}

// Public Showcase/Reference routes and HOME/Admin are the only supported entries.
// Unknown routes must not silently render WORKHUB or load protected projections.
const path = window.location.pathname;
const isShowcase = path === "/showcase" || path === "/showcase/";
const isReference = path === "/reference" || path === "/reference/";
const isWorkhubEntry = path === "/" || path === "/index.html" || path === "/admin" || path === "/admin/";

createRoot(root).render(
  <StrictMode>
    {isShowcase
      ? <WorkhubShowcase />
      : isReference
        ? <ReferenceSite />
      : isWorkhubEntry
        ? <AuthProvider><App /></AuthProvider>
        : <WorkhubNotFound />}
  </StrictMode>,
);
