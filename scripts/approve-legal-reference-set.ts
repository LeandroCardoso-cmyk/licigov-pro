/**
 * A3-RD1 — BOUNDARY OPERACIONAL de APROVAÇÃO/ATIVAÇÃO de reference set governado.
 *
 * Uso:  pnpm db:reference:approve \
 *         --version 1 \
 *         --expected-hash <sha256-hex-64> \
 *         --actor-user-id <id> \
 *         --approval-source "<origem>" \
 *         --correlation-id "<corr>" \
 *         [--actor-role platform_admin] [--law ...] [--jurisdiction ...]
 *
 * É o ÚNICO caminho supervisionado para o owner aprovar/ativar um reference set — sem SQL manual,
 * `tsx -e`, código improvisado ou agente arbitrário. INSTALL ≠ APPROVE: instalar é `db:install:reference`
 * (draft); ATIVAR é este comando, deliberado e auditado, e SÓ após autorização explícita do owner.
 *
 * Contrato de segurança:
 *   - exige DATABASE_URL;
 *   - chama SOMENTE `approveAndActivateReferenceSet` (não migra, não instala, não sobe app);
 *   - exige expectedReferenceHash CORRETO — sem flag --force, sem bypass de hash, e NUNCA busca o
 *     "último hash" para auto-aprovar;
 *   - actor/approvalSource/correlationId explícitos (nunca inferidos silenciosamente);
 *   - fail-closed: exit != 0 em qualquer falha; logs sanitizados (NÃO imprime DATABASE_URL/segredos);
 *   - em sucesso imprime version/hash abreviado/setId/status.
 * NÃO ativa nada no import do módulo — só quando invocado diretamente.
 */
import { approveAndActivateReferenceSet } from "../server/db/legalReference";

function defaultLog(msg: string): void {
  console.info(`[REFERENCE][approve] ${msg}`);
}

export interface ApproveCliArgs {
  version: number;
  expectedReferenceHash: string;
  actorUserId: number;
  approvalSource: string;
  correlationId: string;
  actorRole?: string;
  law?: string;
  jurisdiction?: string;
}

/**
 * Parsing PURO e fail-closed dos argumentos (`--key value` ou `--key=value`). Rejeita ANTES do
 * domínio se faltar qualquer campo obrigatório, se o hash não tiver forma de SHA-256, ou se `--force`
 * for passado (bypass proibido). Nenhum dado é inferido.
 */
export function parseApproveArgs(argv: readonly string[]): ApproveCliArgs {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq >= 0) {
      map.set(a.slice(2, eq), a.slice(eq + 1));
    } else {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) map.set(key, "");
      else { map.set(key, val); i++; }
    }
  }

  if (map.has("force")) {
    throw new Error("Flag --force não é permitida: a aprovação exige expectedReferenceHash correto (sem bypass de hash).");
  }

  const req = (k: string): string => {
    const v = map.get(k);
    if (v === undefined || v.trim() === "") throw new Error(`Argumento obrigatório ausente: --${k}`);
    return v.trim();
  };
  const posInt = (k: string): number => {
    const raw = req(k);
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`--${k} deve ser um inteiro positivo (recebido: ${raw}).`);
    return n;
  };

  const version = posInt("version");
  const expectedReferenceHash = req("expected-hash");
  const actorUserId = posInt("actor-user-id");
  const approvalSource = req("approval-source");
  const correlationId = req("correlation-id");
  const actorRole = map.get("actor-role")?.trim() || undefined;
  const law = map.get("law")?.trim() || undefined;
  const jurisdiction = map.get("jurisdiction")?.trim() || undefined;

  if (!/^[0-9a-f]{64}$/i.test(expectedReferenceHash)) {
    throw new Error("--expected-hash deve ser um SHA-256 hex de 64 caracteres (sem bypass de hash).");
  }

  return { version, expectedReferenceHash, actorUserId, approvalSource, correlationId, actorRole, law, jurisdiction };
}

export interface ApproveDeps {
  approve: typeof approveAndActivateReferenceSet;
  log?: (msg: string) => void;
}

/** Executa a aprovação chamando EXCLUSIVAMENTE o domínio (fail-closed propaga o erro do domínio). */
export async function runApprove(args: ApproveCliArgs, deps: ApproveDeps): Promise<{ setId: number; activated: true }> {
  const log = deps.log ?? defaultLog;
  const shortHash = `${args.expectedReferenceHash.slice(0, 12)}…`;
  log(`Aprovando reference set v${args.version} (hash ${shortHash}) — ator=${args.actorUserId}, fonte="${args.approvalSource}", correlação=${args.correlationId}${args.actorRole ? `, papel=${args.actorRole}` : ""}.`);

  const result = await deps.approve({
    version: args.version,
    expectedReferenceHash: args.expectedReferenceHash,
    actorUserId: args.actorUserId,
    approvalSource: args.approvalSource,
    correlationId: args.correlationId,
    actorRole: args.actorRole,
    law: args.law,
    jurisdiction: args.jurisdiction,
  });

  log(`ATIVADO: setId=${result.setId}, version=${args.version}, status=active, hash=${shortHash}.`);
  return result;
}

export async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    // Nunca imprime o valor — apenas a ausência.
    throw new Error("DATABASE_URL não definida — impossível aprovar/ativar reference set.");
  }
  const args = parseApproveArgs(process.argv.slice(2));
  await runApprove(args, { approve: approveAndActivateReferenceSet });
}

// Só executa quando invocado como script — NUNCA no import (teste/outro módulo).
const invokedDirectly =
  typeof process.argv[1] === "string" && /approve-legal-reference-set(\.ts|\.js|\.mts)?$/.test(process.argv[1]);

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[REFERENCE][approve] FALHA: ${message}`);
      process.exit(1);
    });
}
