/**
 * SEM-046 — projeção do relatório de atividades (`processes.getActivityLogs`).
 *
 * `activity_logs` NÃO tem as colunas `userName`/`description` que a tela lia (resultado: todo registro aparecia como
 * "Sistema" e sem descrição). Os campos reais são `actorName` (snapshot imutável do ator), `userId`, `action` e `details`
 * (texto livre ou JSON). Esta projeção entrega ao cliente um contrato explícito, derivado SOMENTE de campos reais:
 *  - `userName`: snapshot `actorName` → nome do usuário (`users.name`) → `null` (a UI só mostra "Sistema" quando NÃO há ator);
 *  - `description`: `details` em texto legível (JSON vira `chave: valor`), ou `null` — nunca texto inventado.
 */
export interface ActivityReportSourceRow {
  id: number;
  organizationId: number | null;
  processId: number | null;
  userId: number;
  action: string;
  details: string | null;
  actorName: string | null;
  userDisplayName?: string | null;
  entityType: string | null;
  entityId: number | null;
  createdAt: Date | string;
}

export interface ActivityReportEntry {
  id: number;
  organizationId: number | null;
  processId: number | null;
  userId: number;
  userName: string | null;
  action: string;
  description: string | null;
  entityType: string | null;
  entityId: number | null;
  createdAt: Date | string;
}

const DESCRIPTION_MAX = 500;

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** `details` → texto legível. JSON objeto → "chave: valor; …"; texto simples → como está; vazio → null. */
export function describeActivityDetails(details: string | null | undefined): string | null {
  const raw = (details ?? "").trim();
  if (!raw) return null;
  let text = raw;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        text = Object.entries(parsed as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .map(([k, v]) => `${k}: ${scalar(v)}`)
          .join("; ");
      }
    } catch {
      /* texto que apenas começa com "{" — mantém o original */
    }
  }
  if (!text) return null;
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX)}…` : text;
}

export function toActivityReportEntry(row: ActivityReportSourceRow): ActivityReportEntry {
  const snapshot = row.actorName?.trim();
  const live = row.userDisplayName?.trim();
  return {
    id: row.id,
    organizationId: row.organizationId,
    processId: row.processId,
    userId: row.userId,
    userName: snapshot || live || null,
    action: row.action,
    description: describeActivityDetails(row.details),
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt,
  };
}
