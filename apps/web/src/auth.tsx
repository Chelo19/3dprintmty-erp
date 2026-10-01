import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "./api";
import { supabase } from "./supabase";

export interface SessionUser {
  id: string;
  email: string;
  tenantId: string | null;
  role: string | null;
  platformAdmin: boolean;
  impersonator: string | null;
}

interface AuthState {
  token: string | null;
  user: SessionUser | null;
  setSession: (token: string, user: SessionUser) => void;
  adoptSupabaseSession: () => Promise<SessionUser | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readStoredUser(): SessionUser | null {
  const raw = localStorage.getItem("printmty.user");
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

function writeSession(token: string, user: SessionUser) {
  localStorage.setItem("printmty.token", token);
  localStorage.setItem("printmty.user", JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem("printmty.token");
  localStorage.removeItem("printmty.user");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("printmty.token"));
  const [user, setUser] = useState<SessionUser | null>(readStoredUser);

  async function adoptSupabaseSession(): Promise<SessionUser | null> {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    const access = data.session?.access_token;
    if (!access) return null;
    localStorage.setItem("printmty.token", access);
    setToken(access);
    const me = await api<{ user: SessionUser }>("/auth/me");
    writeSession(access, me.user);
    setUser(me.user);
    return me.user;
  }

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (readStoredUser()?.impersonator) return;
      const access = session?.access_token;
      if (!access) {
        if (event === "SIGNED_OUT") {
          clearSession();
          setToken(null);
          setUser(null);
        }
        return;
      }
      localStorage.setItem("printmty.token", access);
      setToken(access);
      window.setTimeout(() => {
        void api<{ user: SessionUser }>("/auth/me")
          .then((me) => {
            if (readStoredUser()?.impersonator) return;
            writeSession(access, me.user);
            setUser(me.user);
          })
          .catch((error: unknown) => {
            if (error instanceof ApiError && (error.code === "unauthenticated" || error.code === "email_taken")) {
              void client.auth.signOut();
              clearSession();
              setToken(null);
              setUser(null);
            }
          });
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function refresh() {
      if (!localStorage.getItem("printmty.token")) return;
      void api<{ user: SessionUser }>("/auth/me")
        .then((me) => {
          const token = localStorage.getItem("printmty.token");
          if (!token) return;
          writeSession(token, me.user);
          setUser(me.user);
        })
        .catch((error: unknown) => {
          if (!supabase && error instanceof ApiError && error.code === "unauthenticated") {
            clearSession();
            setToken(null);
            setUser(null);
          }
        });
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      setSession: (nextToken, nextUser) => {
        writeSession(nextToken, nextUser);
        setToken(nextToken);
        setUser(nextUser);
      },
      adoptSupabaseSession,
      logout: () => {
        void supabase?.auth.signOut();
        clearSession();
        setToken(null);
        setUser(null);
      },
    }),
    [token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider falta en el árbol.");
  return value;
}
