interface SessionAuth {
  signOut: (options: { scope: "local" }) => Promise<{ error: Error | null }>;
}

export async function closeSession(auth: SessionAuth | undefined, storage: Pick<Storage, "removeItem">): Promise<void> {
  if (auth) {
    const { error } = await auth.signOut({ scope: "local" });
    if (error) throw error;
  }
  storage.removeItem("printmty.token");
  storage.removeItem("printmty.user");
}
