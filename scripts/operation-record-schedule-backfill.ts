/**
 * Backfill ONE-OFF da agenda de registros operacionais JÁ EXISTENTES (Centro de Operações).
 *
 * Executor GENÉRICO: o dataset real (item → data, eventos vinculados) NUNCA é versionado — é lido de um
 * arquivo local FORA do repositório (ou na pasta ignorada `ops-private/`) ou de stdin (`--file -`).
 * Por padrão roda em DRY-RUN (nenhuma escrita) e imprime, por entrada: item, registro encontrado,
 * referência, objeto, agenda atual, agenda desejada, classificação e ação planejada.
 *
 *   MATCH           → registro único, sem agenda (será atualizado com --apply);
 *   ALREADY_CORRECT → já igual (nenhuma escrita);
 *   CONFLICT / NOT_FOUND / AMBIGUOUS → entrada bloqueada (nunca cria registro, nunca sobrescreve).
 *
 * `--apply` só grava se o gate passar: CONFLICT = NOT_FOUND = AMBIGUOUS = 0 e MATCH + ALREADY_CORRECT =
 * esperado. A gravação da agenda é UMA transação (reconfere que cada agenda continua vazia), com timeline e
 * o correlationId desta execução; eventos vinculados usam o fluxo idempotente existente. Replay ⇒ ALREADY_CORRECT.
 *
 * Uso:
 *   DATABASE_URL=... tsx scripts/operation-record-schedule-backfill.ts \
 *     --org <organizationId> --expect-slug <slug-da-organização> --file <dataset.json | -> [--apply]
 *
 * Formato do dataset (JSON):
 *   { "referencePrefix": "<prefixo gravado na etapa>", "expected": <n>,
 *     "schedules": [{ "item": 12, "eventDate": "AAAA-MM-DD" }],
 *     "events":    [{ "item": 12, "eventType": "certame", "number": "NN/AAAA", "eventDate": "AAAA-MM-DD", "eventTime": "HH:mm" }] }
 *
 * Exit codes: 0 = ok (dry-run concluído ou gravação aplicada); 1 = configuração inválida; 2 = erro de execução;
 * 3 = gate bloqueado (nada gravado).
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { dirname, resolve, relative, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db/connection";
import { organizations } from "../drizzle/schema";
import { parseScheduleBackfillDataset, type ScheduleBackfillPlan } from "../server/domain/operationRecordScheduleBackfill";
import {
  applyOperationRecordScheduleBackfill, planOperationRecordScheduleBackfill,
} from "../server/services/operationRecordScheduleBackfillService";

export class ConfigError extends Error {}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE_DIR = "ops-private";

export interface CliArgs { org: number; expectSlug: string; file: string; apply: boolean }

export function parseArgs(argv: string[]): CliArgs {
  const get = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const org = Number(get("--org"));
  const expectSlug = get("--expect-slug") ?? "";
  const file = get("--file") ?? "";
  if (!Number.isInteger(org) || org <= 0) throw new ConfigError("--org <organizationId> é obrigatório.");
  if (!expectSlug) throw new ConfigError("--expect-slug <slug> é obrigatório (confirma a organização correta).");
  if (!file) throw new ConfigError("--file <dataset.json | -> é obrigatório.");
  return { org, expectSlug, file, apply: argv.includes("--apply") };
}

/** Recusa datasets dentro do repositório fora da pasta ignorada — evita versionar dados reais por acidente. */
export function assertDatasetOutsideGit(file: string, root = REPO_ROOT): void {
  if (file === "-") return;
  const rel = relative(root, resolve(file));
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  if (inside && !rel.startsWith(`${PRIVATE_DIR}/`) && !rel.startsWith(`${PRIVATE_DIR}\\`)) {
    throw new ConfigError(`O dataset não pode ficar versionável dentro do repositório (${rel}). Use um caminho externo ou ${PRIVATE_DIR}/ (ignorado pelo Git).`);
  }
}

function readDataset(file: string): unknown {
  const text = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  try { return JSON.parse(text); } catch { throw new ConfigError("Dataset não é um JSON válido."); }
}

export function formatPlan(plan: ScheduleBackfillPlan): string {
  const lines: string[] = [];
  lines.push("ITEM | STATUS | REGISTRO | REFERÊNCIA | OBJETO | AGENDA ATUAL | AGENDA DESEJADA | AÇÃO | MOTIVO");
  for (const r of plan.schedules) {
    lines.push([r.item, r.status, r.recordId ?? "—", r.reference ?? "—", (r.object ?? "—").slice(0, 60), r.currentSchedule, r.desiredSchedule, r.action, r.reason].join(" | "));
  }
  if (plan.events.length) {
    lines.push("", "EVENTO | STATUS | REGISTRO | TÍTULO | DATA | HORÁRIO | AÇÃO | MOTIVO");
    for (const e of plan.events) {
      lines.push([`${e.eventType} ${e.number} (item ${e.item})`, e.status, e.recordId ?? "—", (e.title ?? "—").slice(0, 70), e.eventDate, e.eventTime || "dia inteiro", e.action, e.reason].join(" | "));
    }
  }
  const s = plan.scheduleSummary;
  lines.push("", `Agenda — Expected: ${s.expected} · MATCH: ${s.MATCH} · ALREADY_CORRECT: ${s.ALREADY_CORRECT} · CONFLICT: ${s.CONFLICT} · NOT_FOUND: ${s.NOT_FOUND} · AMBIGUOUS: ${s.AMBIGUOUS}`);
  const e = plan.eventSummary;
  lines.push(`Eventos — Total: ${e.expected} · MATCH: ${e.MATCH} · ALREADY_CORRECT: ${e.ALREADY_CORRECT} · CONFLICT: ${e.CONFLICT} · NOT_FOUND: ${e.NOT_FOUND} · AMBIGUOUS: ${e.AMBIGUOUS}`);
  lines.push(plan.canApply ? "Gate: OK" : `Gate: BLOQUEADO — ${plan.blockers.join("; ")}`);
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  assertDatasetOutsideGit(args.file);
  const dataset = parseScheduleBackfillDataset(readDataset(args.file));
  const db = await getDb();
  if (!db) throw new ConfigError("DATABASE_URL ausente ou inválido.");
  const [org] = await db.select({ id: organizations.id, slug: organizations.slug }).from(organizations).where(eq(organizations.id, args.org)).limit(1);
  if (!org || org.slug !== args.expectSlug) throw new ConfigError(`Organização ${args.org} não corresponde ao slug esperado "${args.expectSlug}". Nada foi feito.`);

  const correlationId = `opbf-${randomUUID()}`;
  console.info(`correlationId: ${correlationId} · organização ${org.id} (${org.slug}) · modo: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  if (!args.apply) {
    const plan = await planOperationRecordScheduleBackfill({ organizationId: org.id, dataset, correlationId });
    console.info(formatPlan(plan));
    return plan.canApply ? 0 : 3;
  }
  const result = await applyOperationRecordScheduleBackfill({ organizationId: org.id, dataset, actor: "backfill-agenda", correlationId });
  console.info(formatPlan(result.plan));
  if (!result.applied) { console.info("Nada foi gravado (gate bloqueado)."); return 3; }
  console.info(`Gravado: ${result.updatedRecordIds.length} agenda(s) atualizada(s); ${result.createdEvents.length} evento(s) criado(s).`);
  for (const id of result.updatedRecordIds) console.info(`  agenda atualizada: ${id}`);
  for (const ev of result.createdEvents) console.info(`  evento criado: ${ev.eventId} (${ev.number}, item ${ev.item})`);
  return 0;
}

// Só executa ao rodar diretamente (nunca ao importar `main` de um teste).
const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;

if (isDirectExecution) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(err instanceof ConfigError ? 1 : 2);
  });
}
