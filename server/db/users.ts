import { eq, sql } from "drizzle-orm";
import { InsertUser, users } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { hashPassword, verifyPassword } from "../services/passwordSecurity";
import { getDb } from "./connection";

/** trim + lowercase — mesma normalização de domain/passwordPolicy.ts e domain/invitations.ts. */
function normalizeEmailInput(email: string): string {
  return email.trim().toLowerCase();
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserTheme(userId: number, theme: "light" | "dark" | "system"): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update user theme: database not available");
    return;
  }
  try {
    await db.update(users).set({ theme }).where(eq(users.id, userId));
  } catch (error) {
    console.error("[Database] Failed to update user theme:", error);
    throw error;
  }
}

/** PR A.1 — normaliza o e-mail (trim+lowercase) antes de comparar: o e-mail é a identidade
 *  institucional (convite, recuperação de senha), a busca precisa ser consistente com como é
 *  armazenado (ver createUser abaixo). */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, normalizeEmailInput(email))).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createUser(data: {
  email: string;
  name: string;
  passwordHash: string;
  openId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedEmail = normalizeEmailInput(data.email);

  await db.insert(users).values({
    openId: data.openId,
    email: normalizedEmail,
    name: data.name,
    passwordHash: data.passwordHash,
    loginMethod: "email",
    lastSignedIn: new Date(),
  });

  const result = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  return result[0]!;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * PR A.1 — chamado no login bem-sucedido (mostra "último acesso" na tela de gestão de membros).
 * Nunca lança — atualizar `lastSignedIn` é best-effort, não pode derrubar um login válido.
 */
export async function touchLastSignedIn(userId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
  } catch (error) {
    console.error("[Database] Failed to touch lastSignedIn:", error);
  }
}

/**
 * PR A.1 — Revogação de sessão: incrementa `tokenVersion` ATOMICAMENTE (SET x = x + 1, nunca
 * ler-depois-escrever) — qualquer sessão com claim `tv` menor que o valor atual deixa de validar
 * em `sdk.authenticateRequest`. Chamado ao completar uma redefinição de senha, dentro da mesma
 * transação (passe `txDb`).
 */
export async function bumpTokenVersion(userId: number, txDb?: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbInstance = (txDb as any) ?? (await getDb());
  if (!dbInstance) return;
  await dbInstance.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, userId));
}
