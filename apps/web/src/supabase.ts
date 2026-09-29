import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { api } from "./api";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: true,
          persistSession: true,
        },
      })
    : null;

export function authErrorMessage(error: { message: string }): string {
  const message = error.message.toLowerCase();
  if (message.includes("invalid login")) return "Correo o contraseña incorrectos.";
  if (message.includes("already registered") || message.includes("already been registered")) {
    return "Ese correo ya está registrado.";
  }
  if (message.includes("rate limit") || message.includes("over_email_send_rate_limit")) {
    return "Supabase pausó el envío de correos por unos minutos. El registro ya no depende de ese correo.";
  }
  if (message.includes("provider is not enabled") || message.includes("unsupported provider")) {
    return "Google todavía no está habilitado en el proyecto de Supabase.";
  }
  return error.message;
}

function needsEmailConfirm(error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === "email_not_confirmed" || error.message.toLowerCase().includes("email not confirmed");
}

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error("Supabase Auth no está configurado.");
  let result = await supabase.auth.signInWithPassword({ email, password });
  if (needsEmailConfirm(result.error)) {
    await api("/auth/confirm", { method: "POST", body: JSON.stringify({ email }) });
    result = await supabase.auth.signInWithPassword({ email, password });
  }
  return result;
}

export async function registerWithPassword(email: string, password: string) {
  if (!supabase) throw new Error("Supabase Auth no está configurado.");
  await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error("Supabase Auth no está configurado.");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw new Error(authErrorMessage(error));
}
