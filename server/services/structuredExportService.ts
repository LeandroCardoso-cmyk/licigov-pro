/**
 * Sprint 3.3 — Structured Export Service.
 *
 * JSON / XML / JSON-LD exports for items, audit trails, workflows.
 *
 * PRINCIPLES:
 *   - Replay-safe: same input => same checksum (excluding timestamps).
 *   - Multi-tenant: organizationId mandatory.
 */

import { createHash } from "crypto";
import type { ItemTR } from "../domain/itemTR";
import type { AuditEvent } from "./operationalAuditService";
import type { ApprovalChain } from "../domain/institutionalWorkflow";

// ─── Types ───────────────────────────────────────────────────────────────────

export type StructuredExportFormat = "json" | "xml" | "json_ld";

export type StructuredExportSchema =
  | "item_tr_v1"
  | "tr_v1"
  | "audit_v1"
  | "workflow_v1";

export interface StructuredExport {
  id: string;
  organizationId: number;
  schema: StructuredExportSchema;
  format: StructuredExportFormat;
  version: "1.0";
  payload: Record<string, unknown>;
  checksum: string; // sha256 of payload (excluding timestamps)
  generatedAt: string;
  correlationId: string;
}

export interface InteroperabilityContract {
  schema: StructuredExportSchema;
  format: StructuredExportFormat;
  version: string;
  description: string;
  fields: Record<string, { type: string; description: string; required: boolean }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _counter = 0;
function nextId(seed: string): string {
  _counter++;
  return (
    "exp_" +
    createHash("sha256")
      .update(`${seed}:${_counter}`)
      .digest("hex")
      .slice(0, 24)
  );
}

export function computeExportChecksum(payload: Record<string, unknown>): string {
  // Deterministic: sort keys, exclude dynamic timestamps
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

// ─── Item TR exports ──────────────────────────────────────────────────────────

export function exportItemTRsAsJson(
  items: ItemTR[],
  orgId: number,
): StructuredExport {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    schema: "item_tr_v1",
    organizationId: orgId,
    items: items.map((i) => ({
      id: i.id,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      estimatedPrice: i.estimatedPrice,
      status: i.status,
    })),
    count: items.length,
  };
  const checksum = computeExportChecksum(payload);
  const correlationId = createHash("sha256")
    .update(`${orgId}:item_tr_v1:json:${checksum}`)
    .digest("hex")
    .slice(0, 32);
  const id = nextId(`${orgId}:item_tr_v1:json`);
  return {
    id,
    organizationId: orgId,
    schema: "item_tr_v1",
    format: "json",
    version: "1.0",
    payload,
    checksum,
    generatedAt: now,
    correlationId,
  };
}

export function exportItemTRsAsXml(
  items: ItemTR[],
  orgId: number,
): StructuredExport {
  const now = new Date().toISOString();
  const xmlItems = items
    .map(
      (i) =>
        `  <item id="${i.id}"><description>${i.description}</description><quantity>${i.quantity}</quantity><unit>${i.unit}</unit><estimatedPrice>${i.estimatedPrice}</estimatedPrice><status>${i.status}</status></item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<items organizationId="${orgId}" count="${items.length}">\n${xmlItems}\n</items>`;
  const payload: Record<string, unknown> = { xml, count: items.length, organizationId: orgId };
  const checksum = computeExportChecksum(payload);
  const correlationId = createHash("sha256")
    .update(`${orgId}:item_tr_v1:xml:${checksum}`)
    .digest("hex")
    .slice(0, 32);
  const id = nextId(`${orgId}:item_tr_v1:xml`);
  return {
    id,
    organizationId: orgId,
    schema: "item_tr_v1",
    format: "xml",
    version: "1.0",
    payload,
    checksum,
    generatedAt: now,
    correlationId,
  };
}

// ─── Audit trail export ───────────────────────────────────────────────────────

export function exportAuditTrailAsJson(
  events: AuditEvent[],
  orgId: number,
): StructuredExport {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    schema: "audit_v1",
    organizationId: orgId,
    events: events.map((e) => ({
      id: e.id,
      category: e.category,
      action: e.action,
      actorId: e.actorId,
      targetType: e.targetType,
      targetId: e.targetId,
      occurredAt: e.occurredAt,
    })),
    count: events.length,
  };
  const checksum = computeExportChecksum(payload);
  const correlationId = createHash("sha256")
    .update(`${orgId}:audit_v1:json:${checksum}`)
    .digest("hex")
    .slice(0, 32);
  const id = nextId(`${orgId}:audit_v1:json`);
  return {
    id,
    organizationId: orgId,
    schema: "audit_v1",
    format: "json",
    version: "1.0",
    payload,
    checksum,
    generatedAt: now,
    correlationId,
  };
}

// ─── Workflow export ──────────────────────────────────────────────────────────

export function exportWorkflowAsJson(
  chain: ApprovalChain,
  orgId: number,
): StructuredExport {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    schema: "workflow_v1",
    organizationId: orgId,
    workflow: {
      id: chain.id,
      processId: chain.processId,
      currentStage: chain.currentStage,
      stages: chain.stages,
      historyCount: chain.history.length,
      createdAt: chain.createdAt,
    },
  };
  const checksum = computeExportChecksum(payload);
  const correlationId = createHash("sha256")
    .update(`${orgId}:workflow_v1:json:${checksum}`)
    .digest("hex")
    .slice(0, 32);
  const id = nextId(`${orgId}:workflow_v1:json`);
  return {
    id,
    organizationId: orgId,
    schema: "workflow_v1",
    format: "json",
    version: "1.0",
    payload,
    checksum,
    generatedAt: now,
    correlationId,
  };
}

// ─── Interoperability contract ────────────────────────────────────────────────

const CONTRACTS: Record<StructuredExportSchema, InteroperabilityContract> = {
  item_tr_v1: {
    schema: "item_tr_v1",
    format: "json",
    version: "1.0",
    description: "Exportação de itens de Termo de Referência (Lei 14.133/2021)",
    fields: {
      id: { type: "string", description: "Identificador único do item", required: true },
      description: { type: "string", description: "Descrição do item", required: true },
      quantity: { type: "number", description: "Quantidade estimada", required: true },
      unit: { type: "string", description: "Unidade de medida", required: true },
      estimatedPrice: { type: "number", description: "Preço estimado em centavos", required: false },
      status: { type: "string", description: "Status do item", required: true },
    },
  },
  tr_v1: {
    schema: "tr_v1",
    format: "json",
    version: "1.0",
    description: "Exportação de Termo de Referência completo",
    fields: {
      id: { type: "string", description: "Identificador do TR", required: true },
      sections: { type: "array", description: "Seções do TR", required: true },
      organizationId: { type: "number", description: "Organização", required: true },
    },
  },
  audit_v1: {
    schema: "audit_v1",
    format: "json",
    version: "1.0",
    description: "Exportação de trilha de auditoria operacional",
    fields: {
      id: { type: "string", description: "ID do evento de auditoria", required: true },
      category: { type: "string", description: "Categoria do evento", required: true },
      action: { type: "string", description: "Ação realizada", required: true },
      actorId: { type: "number", description: "ID do ator", required: true },
      occurredAt: { type: "string", description: "Data/hora do evento (ISO 8601)", required: true },
    },
  },
  workflow_v1: {
    schema: "workflow_v1",
    format: "json",
    version: "1.0",
    description: "Exportação de workflow institucional (cadeia de aprovação)",
    fields: {
      id: { type: "string", description: "ID do workflow", required: true },
      processId: { type: "number", description: "ID do processo", required: true },
      currentStage: { type: "string", description: "Estágio atual", required: true },
      stages: { type: "array", description: "Lista de estágios", required: true },
    },
  },
};

export function getInteroperabilityContract(
  schema: StructuredExportSchema,
): InteroperabilityContract {
  const contract = CONTRACTS[schema];
  if (!contract) {
    throw new Error(`Schema desconhecido: ${schema}`);
  }
  return contract;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateExportPayload(
  payload: Record<string, unknown>,
  schema: StructuredExportSchema,
): { valid: boolean; errors: string[] } {
  const contract = CONTRACTS[schema];
  if (!contract) {
    return { valid: false, errors: [`Schema desconhecido: ${schema}`] };
  }
  const errors: string[] = [];
  for (const [field, def] of Object.entries(contract.fields)) {
    if (def.required && !(field in payload)) {
      errors.push(`Campo obrigatório ausente: ${field}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
