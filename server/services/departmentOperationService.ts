/**
 * FASE 5 — Department Operation Service (Centro de Operações)
 *
 * CONSOLIDA (sem duplicar) todos os Business Domains para responder: "como está o
 * departamento agora?", "o que precisa de atenção?", "o que acontece hoje/depois?".
 * Lê os domínios por referência (listProcesses, listContractWorkspaces, …) — nunca
 * copia dados. Reutiliza o Adaptive Recommendation Engine e o Kernel Access Service.
 * Degrada sem DB. Determinístico, multi-tenant.
 */

import { assertKernelAccess } from "./kernelAccessService";
import { recommendStep } from "../domain/adaptiveRecommendationEngine";
import {
  computeIndicators, situationColor, type OperationalIndicators, type MonitoringRow,
} from "../domain/operationalDashboard";
import { listProcesses } from "../db/procurement";
import { listDirectProcurementWorkspaces } from "../db/directProcurement";
import { listContractWorkspaces, countContractAddendaByOrg } from "../db/contractWorkspace";
import { listLegalOpinionWorkspaces } from "../db/legalOpinionWorkspace";
import { listPendingForDomain } from "../db/institutionalRequests";
import { listOperationalEvents, listOperationalTimeline, listOperationRecords } from "../db/departmentOperation";

const DOMAIN = "gestao_departamento" as const;
const LEGAL_DOMAIN = "parecer_juridico" as const;

/** Reúne o estado consolidado do departamento (sem duplicar dados dos domínios). */
async function collect(orgId: number) {
  const [processes, directs, contracts, legalPending, requestsPending, addendaCount] = await Promise.all([
    listProcesses(orgId, 200),
    listDirectProcurementWorkspaces(orgId, 200),
    listContractWorkspaces(orgId, 200),
    listLegalOpinionWorkspaces(orgId, { activeOnly: true, limit: 200 }),
    listPendingForDomain(orgId, LEGAL_DOMAIN, 200),
    countContractAddendaByOrg(orgId),
  ]);
  return { processes, directs, contracts, legalPending, requestsPending, addendaCount };
}

export interface DepartmentSnapshot {
  readonly indicators: OperationalIndicators;
  readonly todayEvents: Awaited<ReturnType<typeof listOperationalEvents>>;
  readonly upcomingEvents: Awaited<ReturnType<typeof listOperationalEvents>>;
}

/** ÁREA 1 — Centro de Operações: indicadores + eventos de hoje e futuros. */
export async function getDashboard(params: { organizationId: number; today: string }): Promise<DepartmentSnapshot> {
  assertKernelAccess(DOMAIN, "observability");
  const { processes, directs, contracts, legalPending, requestsPending, addendaCount } = await collect(params.organizationId);
  const events = await listOperationalEvents(params.organizationId, { limit: 500 });

  const contractsExpiringSoon = events.filter(e =>
    e.eventType === "vencimento_contrato" && e.eventDate >= params.today).length;

  const indicators = computeIndicators({
    processes, directProcurements: directs, contracts,
    legalOpinionsPending: legalPending.length, institutionalRequestsPending: requestsPending.length,
    addendaCount, contractsExpiringSoon, pendingTasks: 0,
  });

  const todayEvents = events.filter(e => e.eventDate === params.today);
  const upcomingEvents = events.filter(e => e.eventDate > params.today).slice(0, 50);
  return { indicators, todayEvents, upcomingEvents };
}

/** ÁREA 2 — Painel de Acompanhamento: uma linha por contratação (versão inteligente). */
export async function getMonitoringPanel(params: { organizationId: number; today: string }): Promise<MonitoringRow[]> {
  const { processes, directs } = await collect(params.organizationId);
  const concluded = new Set(["emitido", "arquivado", "concluido", "publicado"]);

  const fromProcesses: MonitoringRow[] = processes.map(p => ({
    processId: p.id, processNumber: p.processNumber, object: p.object, modality: p.modality ?? "",
    currentStage: p.currentStage, origin: "processo_licitatorio",
    situation: situationColor({ overdue: false, concluded: concluded.has(p.status), hasFutureEvent: false, started: p.currentStage !== "NEW_PROCESS" }),
  }));
  const fromDirects: MonitoringRow[] = directs.map(d => ({
    processId: d.id, processNumber: d.processNumber, object: d.object, modality: d.procurementType,
    currentStage: d.currentStage, origin: "contratacao_direta",
    situation: situationColor({ overdue: false, concluded: concluded.has(d.status), hasFutureEvent: false, started: d.currentStage !== "NEW" }),
  }));
  return [...fromProcesses, ...fromDirects];
}

/** ÁREA 3 — Calendário Operacional: eventos por janela (diária/semanal/mensal). */
export async function getCalendar(params: { organizationId: number; from: string; to: string }): Promise<Awaited<ReturnType<typeof listOperationalEvents>>> {
  return listOperationalEvents(params.organizationId, { from: params.from, to: params.to, limit: 500 });
}

/** ÁREA 4 — Timeline Operacional (append-only). */
export async function getTimeline(params: { organizationId: number; limit?: number }): Promise<Awaited<ReturnType<typeof listOperationalTimeline>>> {
  return listOperationalTimeline(params.organizationId, params.limit ?? 100);
}

/** ÁREA 5 — Minha Caixa de Entrada: pendências do usuário (pareceres, solicitações). */
export async function getInbox(params: { organizationId: number; userId: number }): Promise<{
  legalOpinions: Awaited<ReturnType<typeof listLegalOpinionWorkspaces>>;
  institutionalRequests: Awaited<ReturnType<typeof listPendingForDomain>>;
  records: Awaited<ReturnType<typeof listOperationRecords>>;
}> {
  const [legalOpinions, institutionalRequests, records] = await Promise.all([
    listLegalOpinionWorkspaces(params.organizationId, { activeOnly: true, limit: 100 }),
    listPendingForDomain(params.organizationId, LEGAL_DOMAIN, 100),
    listOperationRecords(params.organizationId, 100),
  ]);
  const mine = legalOpinions.filter(o => o.assignedLawyer === params.userId || o.assignedLawyer === null);
  const myRecords = records.filter(r => r.responsible === params.userId || r.recordType === "tarefa");
  return { legalOpinions: mine, institutionalRequests, records: myRecords };
}

export interface OperationalRecommendation {
  readonly kind: "priorizacao" | "gargalo" | "risco" | "sobrecarga" | "vencimento";
  readonly title: string;
  readonly reasoning: string;
  readonly legalBasis: readonly string[];
  readonly confidence: number;
  readonly impact: string;
  readonly alternatives: readonly string[];
}

/**
 * Recomendações operacionais (priorização, gargalos, riscos, sobrecarga, vencimentos).
 * Reutiliza o Adaptive Recommendation Engine. O servidor SEMPRE decide.
 */
export async function getRecommendations(params: { organizationId: number; today: string }): Promise<OperationalRecommendation[]> {
  assertKernelAccess(DOMAIN, "explainability");
  const { legalPending, requestsPending } = await collect(params.organizationId);
  const events = await listOperationalEvents(params.organizationId, { limit: 500 });
  const out: OperationalRecommendation[] = [];

  const expiring = events.filter(e => e.eventType === "vencimento_contrato" && e.eventDate >= params.today);
  if (expiring.length > 0) {
    const base = recommendStep({ step: "aditivo" });
    out.push({
      kind: "vencimento", title: `${expiring.length} contrato(s) com vencimento próximo`,
      reasoning: "Contratos próximos do vencimento podem exigir aditivo de prorrogação ou nova contratação.",
      legalBasis: base.legalBasis, confidence: 0.85, impact: "alto",
      alternatives: ["Elaborar aditivo de prazo", "Iniciar nova contratação", "Encerrar o contrato"],
    });
  }
  if (legalPending.length >= 5) {
    out.push({
      kind: "gargalo", title: `Fila de pareceres com ${legalPending.length} itens`,
      reasoning: "Volume elevado de pareceres pendentes indica possível gargalo no jurídico.",
      legalBasis: [], confidence: 0.7, impact: "medio",
      alternatives: ["Redistribuir pareceres", "Priorizar por prazo", "Reforçar a equipe"],
    });
  }
  if (requestsPending.length >= 5) {
    out.push({
      kind: "sobrecarga", title: `${requestsPending.length} solicitações institucionais pendentes`,
      reasoning: "Solicitações acumuladas podem atrasar processos que dependem de resposta institucional.",
      legalBasis: [], confidence: 0.68, impact: "medio",
      alternatives: ["Priorizar solicitações críticas", "Acompanhar respostas", "Rever prazos internos"],
    });
  }
  return out;
}

// ─── Relatórios (DOCX/PDF via Document Engine) ─────────────────────────────────

export type OperationalReportKind = "operacional" | "pendencias" | "produtividade";

/** Gera o conteúdo de um relatório operacional. Saídas oficiais: DOCX + PDF. */
export async function generateOperationalReport(params: { organizationId: number; kind: OperationalReportKind; today: string }): Promise<{ kind: OperationalReportKind; title: string; content: string; formats: readonly string[] }> {
  assertKernelAccess(DOMAIN, "document_engine");
  const snapshot = await getDashboard({ organizationId: params.organizationId, today: params.today });
  const i = snapshot.indicators;
  const titleMap: Record<OperationalReportKind, string> = {
    operacional: "Relatório Operacional", pendencias: "Relatório de Pendências", produtividade: "Relatório de Produtividade",
  };
  const content = [
    `# ${titleMap[params.kind]}`,
    `Data de referência: ${params.today}`,
    "",
    "## Indicadores",
    `- Processos ativos: ${i.activeProcesses}`,
    `- Processos concluídos: ${i.concludedProcesses}`,
    `- Pareceres aguardando: ${i.legalOpinionsAwaiting}`,
    `- Contratos ativos: ${i.activeContracts}`,
    `- Contratos vencendo: ${i.contractsExpiring}`,
    `- Solicitações pendentes: ${i.pendingRequests}`,
    "",
    "> Relatório consolidado automaticamente dos Business Domains. Revisão pelo servidor.",
  ].join("\n");
  return { kind: params.kind, title: titleMap[params.kind], content, formats: ["docx", "pdf"] };
}
