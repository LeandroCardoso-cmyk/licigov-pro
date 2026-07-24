/**
 * PR A.1 — Projeção pública de `User`. `auth.me` e `admin.listUsers` retornavam a linha
 * COMPLETA da tabela `users` — incluindo `passwordHash` e `signaturePassword` (hashes bcrypt) —
 * diretamente ao cliente. `sanitizeUser` é o único ponto por onde um `User` deve passar antes de
 * sair de um router.
 *
 * Também omite `loginMethod`/`updatedAt` (não consumidos pelo frontend hoje — nenhuma
 * necessidade de expor) e `tokenVersion` (mecanismo interno de revogação de sessão, nunca
 * relevante para o cliente).
 */

import type { User } from "../../drizzle/schema";

export interface PublicUser {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  role: User["role"];
  theme: User["theme"];
  createdAt: Date;
  lastSignedIn: Date;
}

export function sanitizeUser(user: User): PublicUser {
  return {
    id: user.id,
    openId: user.openId,
    name: user.name,
    email: user.email,
    role: user.role,
    theme: user.theme,
    createdAt: user.createdAt,
    lastSignedIn: user.lastSignedIn,
  };
}

export function sanitizeUsers(users: User[]): PublicUser[] {
  return users.map(sanitizeUser);
}
