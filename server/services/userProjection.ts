/**
 * PR A.1 — Projeção pública de `User`. `auth.me`, `admin.listUsers` e
 * `organizations.listAllMembersWithUsers` retornavam/retornariam a linha COMPLETA da tabela
 * `users` — incluindo `passwordHash` e `signaturePassword` (hashes bcrypt) — diretamente ao
 * cliente. `sanitizeUser` é o ÚNICO ponto por onde um `User` deve passar antes de sair de um router.
 *
 * Campos deliberadamente OMITIDOS (nunca saem para o cliente):
 * - `passwordHash`, `signaturePassword` — hashes bcrypt (o vazamento original).
 * - `tokenVersion` — mecanismo interno de revogação de sessão.
 * - `openId` — subject do JWT; identificador interno da sessão. Nenhum consumo no frontend
 *   (verificado). Expor o `openId` de OUTROS usuários (ex.: lista de membros) é vazar um
 *   identificador interno sem necessidade — removido como defesa em profundidade.
 * - `loginMethod`, `updatedAt` — sem consumo no frontend.
 */

import type { User } from "../../drizzle/schema";

export interface PublicUser {
  id: number;
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
