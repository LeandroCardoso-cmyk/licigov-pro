/**
 * Regras PURAS da EXECUÇÃO controlada do registro de candidato (Domain Layer, sem IO).
 *
 * 1. Guarda de execução INDEPENDENTE de variáveis de ambiente: `APP_ENV`/`NODE_ENV` são rótulos e podem estar errados; por isso TODA execução
 *    (qualquer ambiente) exige (a) a confirmação exata dos identificadores, (b) `--allow-production` e (c) o nome do banco esperado, conferido contra
 *    o banco efetivamente conectado. Os rótulos de ambiente nunca dispensam nenhuma delas.
 * 2. Atribuição: o ator registrado é o usuário AUTENTICADO (credencial do próprio sistema), nunca um id digitado; a autoridade declarada em arquivo
 *    é amarrada a esse usuário (um `decidedByUserId` divergente é recusado).
 */
/** Autoridade declarada (forma estrutural idêntica à do ledger institucional; o domínio não importa serviços). */
export interface DeclaredAuthorityShape {
  readonly decidedByName: string;
  readonly decidedByRole: string;
  readonly decidedByUserId?: number | null;
  readonly decidedAt: string;
  readonly basisReference: string;
  readonly reason: string;
}

export type ExecutionRole = "viewer" | "operator" | "manager" | "admin" | "owner";
export const ROLE_RANK: Readonly<Record<ExecutionRole, number>> = Object.freeze({ viewer: 0, operator: 1, manager: 2, admin: 3, owner: 4 });
/** Piso técnico de papel para registrar (mesmo de `TEMPLATE_ACTION_MIN_ROLE.register`). */
export const EXECUTION_MIN_ROLE: ExecutionRole = "operator";
export const roleAtLeast = (role: string | null | undefined, min: ExecutionRole = EXECUTION_MIN_ROLE): boolean => role != null && role in ROLE_RANK && ROLE_RANK[role as ExecutionRole] >= ROLE_RANK[min];

export interface ExecutionGuardInput {
  readonly confirm: string | undefined;
  readonly confirmExpected: string;
  readonly allowProduction: boolean;
  readonly expectDatabase: string | undefined;
  /** Rótulos de ambiente — informativos; NUNCA relaxam uma guarda. */
  readonly appEnv?: string | undefined;
  readonly nodeEnv?: string | undefined;
}

/** Guardas que independem do banco. Devolve os motivos de recusa (vazio = pode seguir para a conferência do banco). */
export function executionGuardFailures(g: ExecutionGuardInput): readonly string[] {
  const out: string[] = [];
  if (g.confirm !== g.confirmExpected) out.push(`--confirm deve ser exatamente: ${g.confirmExpected}`);
  if (!g.allowProduction) out.push("RECUSADO: toda execução exige --allow-production (decisão humana explícita); APP_ENV/NODE_ENV são rótulos e nunca dispensam esta guarda");
  if (!g.expectDatabase || !/^[A-Za-z0-9_$-]{1,64}$/.test(g.expectDatabase)) out.push("--expect-database=<nome do banco> é obrigatório (o nome é conferido contra o banco realmente conectado)");
  return out;
}

export function databaseMatches(expected: string, actual: string | null | undefined): boolean {
  return !!actual && expected === actual;
}

/** Amarra a autoridade declarada ao usuário autenticado. `decidedByUserId` informado e diferente ⇒ recusa. */
export function bindAuthorityToExecutor(authority: Record<string, unknown>, authenticatedUserId: number): DeclaredAuthorityShape {
  for (const k of ["decidedByName", "decidedByRole", "decidedAt", "basisReference", "reason"]) {
    if (typeof authority[k] !== "string" || !(authority[k] as string).trim()) throw new Error(`authority-file: campo obrigatório ausente: ${k}`);
  }
  const declared = authority.decidedByUserId;
  if (declared !== undefined && declared !== null && declared !== authenticatedUserId) {
    throw new Error("authority-file: decidedByUserId difere do usuário autenticado (a autoridade declarada precisa ser a de quem executa)");
  }
  return { ...(authority as unknown as DeclaredAuthorityShape), decidedByUserId: authenticatedUserId };
}

export interface ExecutorCredentials { readonly email: string; readonly password: string }
/** Credenciais SÓ de variáveis de ambiente (nunca argv: não vão para histórico de shell nem lista de processos). */
export function executorCredentialsFromEnv(env: Readonly<Record<string, string | undefined>>): ExecutorCredentials {
  const email = env.CANDIDATE_EXECUTOR_EMAIL?.trim();
  const password = env.CANDIDATE_EXECUTOR_PASSWORD;
  if (!email || !password) throw new Error("autenticação do executor: defina CANDIDATE_EXECUTOR_EMAIL e CANDIDATE_EXECUTOR_PASSWORD (credenciais do próprio sistema; nunca por argumento)");
  return { email, password };
}
