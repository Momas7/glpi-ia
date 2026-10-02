import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;

export function createDb(connectionUrl: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionUrl }) });
}

const globalForDb = globalThis as unknown as { db?: Db };

/** Singleton para web e worker; reaproveitado no hot reload do Next em dev. */
export function getDb(): Db {
  globalForDb.db ??= createDb(process.env.DATABASE_URL ?? "");
  return globalForDb.db;
}
