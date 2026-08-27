import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "@/App";
import { AuthProvider } from "@/auth";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

// No manual toggle by design; mirror the OS preference onto the class shadcn
// expects, and keep following it if the user changes it mid-session.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (matches: boolean) =>
  document.documentElement.classList.toggle("dark", matches);
applyTheme(dark.matches);
dark.addEventListener("change", (e) => applyTheme(e.matches));

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
