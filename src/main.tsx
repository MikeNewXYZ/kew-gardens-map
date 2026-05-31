import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PresenceProvider } from "./lib/presence.tsx";
import { router } from "./router.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PresenceProvider>
      <RouterProvider router={router} />
    </PresenceProvider>
  </StrictMode>,
);
