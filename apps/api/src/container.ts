import { AuthService } from "./modules/auth.service";
import { DatabaseService, type DbOptions } from "./db/database.service";

export interface Container {
  database: DatabaseService;
  auth: AuthService;
}

let current: Container | null = null;

export function services(): Container {
  if (!current) {
    throw new Error("La API todavía no arranca.");
  }
  return current;
}

export async function startContainer(options: DbOptions = {}): Promise<Container> {
  const database = new DatabaseService(options);
  await database.onModuleInit();
  const auth = new AuthService(database);
  current = { database, auth };
  return current;
}

export async function stopContainer(): Promise<void> {
  await current?.database.onModuleDestroy();
  current = null;
}
