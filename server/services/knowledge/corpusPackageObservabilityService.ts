/**
 * RC-4.6 — Federal Procurement Corpus Package · Observabilidade (Part 10).
 *
 * Registra eventos do ciclo de vida de pacotes de corpus: packageRegistered, packageLoaded,
 * manifestValidated, projectionGenerated, collectionRegistered. Recuperável por correlationId.
 * Multi-tenant. Determinístico. Retenção simples em memória.
 */

export type PackageEventType =
  | "packageRegistered" | "packageLoaded" | "manifestValidated"
  | "projectionGenerated" | "collectionRegistered";

export interface PackageEvent {
  readonly correlationId: string;
  readonly tenantId: number;
  readonly type: PackageEventType;
  /** Identificador estrutural relacionado (packageId/collectionId) — nunca conteúdo. */
  readonly subjectId: string;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, PackageEvent[]>();
const RETENTION = 200;
let _total = 0;

export function recordPackageEvent(ev: PackageEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[corpus-package-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, subjectId: ev.subjectId, count: ev.count }));
  } catch { /* noop */ }
}

/** Eventos registrados para um correlationId. */
export function getPackageEvents(correlationId: string): readonly PackageEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearPackageEvents(): void { _byCorrelation.clear(); _total = 0; }
