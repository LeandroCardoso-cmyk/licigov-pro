export type CommunicationType =
  | "deployment_alert"
  | "workflow_alert"
  | "degradation_notice"
  | "escalation_alert"
  | "onboarding_reminder"
  | "support_notification"
  | "sla_breach"
  | "recovery_notice"
  | "governance_notice";

export type CommunicationPriority = "low" | "medium" | "high" | "critical";

export interface CommunicationRecord {
  readonly id:             string;
  readonly organizationId: number;
  readonly type:           CommunicationType;
  readonly priority:       CommunicationPriority;
  readonly subject:        string;
  readonly body:           string;
  readonly recipientRoles: string[];
  readonly deliveredAt:    string;
  readonly metadata:       Record<string, unknown>;
  acknowledgedAt:          string | null;
}

const _records: CommunicationRecord[] = [];
let _counter = 0;

function create(
  organizationId: number,
  type:           CommunicationType,
  priority:       CommunicationPriority,
  subject:        string,
  body:           string,
  recipientRoles: string[],
  metadata:       Record<string, unknown> = {},
): CommunicationRecord {
  const record: CommunicationRecord = {
    id:             `comm_${++_counter}`,
    organizationId,
    type,
    priority,
    subject,
    body,
    recipientRoles,
    deliveredAt:    new Date().toISOString(),
    metadata,
    acknowledgedAt: null,
  };
  _records.push(record);
  return { ...record };
}

export function sendAlert(
  organizationId: number,
  type:           CommunicationType,
  priority:       CommunicationPriority,
  subject:        string,
  body:           string,
  recipientRoles: string[],
): CommunicationRecord {
  return create(organizationId, type, priority, subject, body, recipientRoles);
}

export function sendDeploymentNotification(
  organizationId: number,
  deploymentId:   string,
  phase:          string,
  notes:          string = "",
): CommunicationRecord {
  return create(
    organizationId,
    "deployment_alert",
    "high",
    `Deployment ${deploymentId} — Fase: ${phase}`,
    notes || `O deployment avançou para a fase: ${phase}`,
    ["admin", "gestor"],
    { deploymentId, phase },
  );
}

export function sendDegradationNotice(
  organizationId: number,
  metricName:     string,
  currentValue:   number,
  threshold:      number,
): CommunicationRecord {
  return create(
    organizationId,
    "degradation_notice",
    "high",
    `Degradação detectada: ${metricName}`,
    `Métrica ${metricName} atingiu ${currentValue}, acima do limiar ${threshold}`,
    ["admin", "gestor"],
    { metricName, currentValue, threshold },
  );
}

export function sendEscalationAlert(
  organizationId: number,
  incidentId:     string,
  escalateTo:     string,
): CommunicationRecord {
  return create(
    organizationId,
    "escalation_alert",
    "critical",
    `Escalação de Incidente ${incidentId}`,
    `O incidente ${incidentId} foi escalado para: ${escalateTo}`,
    [escalateTo, "admin"],
    { incidentId, escalateTo },
  );
}

export function sendSlaBreachAlert(
  organizationId: number,
  metricName:     string,
  value:          number,
  target:         number,
): CommunicationRecord {
  return create(
    organizationId,
    "sla_breach",
    "critical",
    `SLA Breach: ${metricName}`,
    `Métrica ${metricName} violou o SLA: valor atual ${value}, alvo ${target}`,
    ["admin", "gestor"],
    { metricName, value, target },
  );
}

export function sendRecoveryNotice(
  organizationId: number,
  planId:         string,
  outcome:        "success" | "failed" | "partial",
): CommunicationRecord {
  const priority: CommunicationPriority = outcome === "success" ? "medium" : "critical";
  return create(
    organizationId,
    "recovery_notice",
    priority,
    `Recovery ${planId} — ${outcome}`,
    `O plano de recuperação ${planId} foi concluído com resultado: ${outcome}`,
    ["admin"],
    { planId, outcome },
  );
}

export function getRecentCommunications(organizationId: number, limit: number = 20): CommunicationRecord[] {
  return _records
    .filter(r => r.organizationId === organizationId)
    .slice(-limit)
    .map(r => ({ ...r }));
}

export function acknowledgeCommunication(id: string): CommunicationRecord {
  const idx = _records.findIndex(r => r.id === id);
  if (idx < 0) throw new Error(`Communication ${id} not found`);
  _records[idx] = { ..._records[idx], acknowledgedAt: new Date().toISOString() };
  return { ..._records[idx] };
}

export function getCommunicationsByType(organizationId: number, type: CommunicationType): CommunicationRecord[] {
  return _records.filter(r => r.organizationId === organizationId && r.type === type).map(r => ({ ...r }));
}
