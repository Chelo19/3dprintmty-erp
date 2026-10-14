import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api } from "./api";
import { supabase } from "./supabase";
import { closeSession } from "./session";

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
  logout: () => Promise<void>;
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
  const revision = useRef(0);
  const closing = useRef(false);

  function resetSession() {
    revision.current += 1;
    clearSession();
    setToken(null);
    setUser(null);
  }

  async function adoptSupabaseSession(): Promise<SessionUser | null> {
    if (!supabase) return null;
    const expectedRevision = revision.current;
    const { data } = await supabase.auth.getSession();
    if (closing.current || revision.current !== expectedRevision) return null;
    const access = data.session?.access_token;
    if (!access) return null;
    localStorage.setItem("printmty.token", access);
    setToken(access);
    const me = await api<{ user: SessionUser }>("/auth/me");
    if (closing.current || revision.current !== expectedRevision || localStorage.getItem("printmty.token") !== access) return null;
    writeSession(access, me.user);
    setUser(me.user);
    return me.user;
  }

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        resetSession();
        return;
      }
      if (closing.current) return;
      if (readStoredUser()?.impersonator) return;
      const access = session?.access_token;
      if (!access) return;
      const expectedRevision = revision.current;
      localStorage.setItem("printmty.token", access);
      setToken(access);
      window.setTimeout(() => {
        if (closing.current || revision.current !== expectedRevision || localStorage.getItem("printmty.token") !== access) return;
        void api<{ user: SessionUser }>("/auth/me")
          .then((me) => {
            if (closing.current || revision.current !== expectedRevision || localStorage.getItem("printmty.token") !== access || readStoredUser()?.impersonator) return;
            writeSession(access, me.user);
            setUser(me.user);
          })
          .catch((error: unknown) => {
            if (closing.current || revision.current !== expectedRevision || localStorage.getItem("printmty.token") !== access) return;
            if (error instanceof ApiError && (error.code === "unauthenticated" || error.code === "email_taken")) {
              void client.auth.signOut({ scope: "local" }).catch(() => {});
              resetSession();
            }
          });
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function refresh() {
      const access = localStorage.getItem("printmty.token");
      const expectedRevision = revision.current;
      if (!access || closing.current) return;
      void api<{ user: SessionUser }>("/auth/me")
        .then((me) => {
          if (closing.current || revision.current !== expectedRevision || localStorage.getItem("printmty.token") !== access) return;
          writeSession(access, me.user);
          setUser(me.user);
        })
        .catch((error: unknown) => {
          if (closing.current || revision.current !== expectedRevision || localStorage.getItem("printmty.token") !== access) return;
          if (!supabase && error instanceof ApiError && error.code === "unauthenticated") {
            resetSession();
          }
        });
    }
    refresh();
    window.addEventListener("focus", refresh);
    function syncSession(event: StorageEvent) {
      if (event.key !== null && event.key !== "printmty.token" && event.key !== "printmty.user") return;
      revision.current += 1;
      setToken(localStorage.getItem("printmty.token"));
      setUser(readStoredUser());
    }
    window.addEventListener("storage", syncSession);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", syncSession);
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      setSession: (nextToken, nextUser) => {
        revision.current += 1;
        writeSession(nextToken, nextUser);
        setToken(nextToken);
        setUser(nextUser);
      },
      adoptSupabaseSession,
      logout: async () => {
        if (closing.current) return;
        closing.current = true;
        revision.current += 1;
        try {
          await closeSession(supabase?.auth, localStorage);
          resetSession();
        } finally {
          closing.current = false;
        }
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
