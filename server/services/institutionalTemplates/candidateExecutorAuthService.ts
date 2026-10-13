/**
 * Autenticação do EXECUTOR do CLI de candidato (Services Layer).
 *
 * Mecanismo: a MESMA credencial do login do sistema (e-mail + senha, bcrypt) — nenhuma credencial nova, nenhum token novo, nenhuma rota. O ator
 * registrado no ledger é o usuário autenticado aqui (não um id digitado). Exige membership ATIVA na organização alvo com papel ≥ operator.
 *
 * Fail-closed e anti-enumeração: e-mail desconhecido, sem senha, senha errada, sem membership, membership inativa ou papel insuficiente produzem a
 * MESMA recusa (`EXECUTOR_AUTH_FAILED`); a senha é sempre comparada (hash fictício quando o usuário não existe). Nunca loga senha, e-mail nem hash.
 * Limites (documentados no runbook): prova conhecimento da credencial, não posse física/MFA (o sistema não tem MFA) e não há rate limit entre
 * invocações (o limitador do login é em memória do servidor).
 */
import { randomBytes } from "node:crypto";
import { roleAtLeast, type ExecutionRole } from "../../domain/institutionalTemplates/candidateExecution";
import { hashPassword } from "../passwordSecurity";

export class ExecutorAuthError extends Error {
  readonly code = "EXECUTOR_AUTH_FAILED";
  constructor() { super("EXECUTOR_AUTH_FAILED: credenciais inválidas ou usuário sem permissão ativa nesta organização (nada foi alterado)"); this.name = "ExecutorAuthError"; }
}

export interface ExecutorAuthDeps {
  getUserByEmail(email: string): Promise<{ id: number; name: string | null; passwordHash: string | null } | undefined>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  getActiveMemberRole(organizationId: number, userId: number): Promise<ExecutionRole | null>;
}

export interface AuthenticatedExecutor { readonly userId: number; readonly name: string | null; readonly role: ExecutionRole }

// bcrypt (mesmo custo do sistema) de um valor aleatório descartado: iguala o custo quando o usuário não existe.
let dummyHash: Promise<string> | null = null;
const getDummyHash = (): Promise<string> => (dummyHash ??= hashPassword(randomBytes(24).toString("hex")));

export async function authenticateExecutor(deps: ExecutorAuthDeps, organizationId: number, creds: { readonly email: string; readonly password: string }): Promise<AuthenticatedExecutor> {
  const user = await deps.getUserByEmail(creds.email);
  const valid = await deps.verifyPassword(creds.password, user?.passwordHash ?? await getDummyHash());
  if (!user || !user.passwordHash || !valid) throw new ExecutorAuthError();
  const role = await deps.getActiveMemberRole(organizationId, user.id);
  if (!role || !roleAtLeast(role)) throw new ExecutorAuthError();
  return { userId: user.id, name: user.name ?? null, role };
}
