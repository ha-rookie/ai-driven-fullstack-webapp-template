import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WorkhubShowcase from "./reference/showcase/WorkhubShowcase";
import { AuthProvider } from "./frontend/auth";
import "./workhub-business.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
