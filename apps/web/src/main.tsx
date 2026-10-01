import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useMemo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider, useAuth } from "./auth";
import "./i18n";
import "./styles.css";

function SessionQueries({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Las respuestas de otra cuenta, taller o rol no deben sobrevivir al cambio de sesión.
  const scope = `${user?.id}:${user?.tenantId}:${user?.role}:${user?.impersonator}`;
  const queryClient = useMemo(() => new QueryClient(), [scope]);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <SessionQueries>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionQueries>
    </AuthProvider>
  </StrictMode>,
);
