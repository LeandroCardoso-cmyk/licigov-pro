/**
 * Sprint 1.8 — Optimistic Locking Foundation.
 *
 * Estratégia oficial de concorrência do LiciGov Pro.
 * Usada em qualquer entidade que suporta edição simultânea:
 * documentos, processos, contratos, pareceres.
 */
import { TRPCError } from "@trpc/server";

/**
 * Marca uma entidade como versionada para optimistic locking.
 */
export interface VersionedEntity {
  version: number;
  updatedAt: Date;
}

/**
 * Lançada quando uma atualização tenta modificar uma versão desatualizada.
 * Deve ser convertida para CONFLICT (HTTP 409) antes de chegar ao cliente.
 */
export class OptimisticLockConflictError extends Error {
  readonly code = "OPTIMISTIC_LOCK_CONFLICT" as const;

  constructor(
    public readonly entityType: string,
    public readonly entityId: string | number,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Conflito de versão em ${entityType}#${entityId}: ` +
      `esperado v${expectedVersion}, encontrado v${actualVersion}. ` +
      `Recarregue e tente novamente.`,
    );
    this.name = "OptimisticLockConflictError";
  }
}

/**
 * Verifica se a versão esperada coincide com a atual.
 * Lança OptimisticLockConflictError se houver divergência.
 */
export function assertVersion(
  expected: number,
  actual: number,
  entityType: string,
  entityId: string | number,
): void {
  if (expected !== actual) {
    throw new OptimisticLockConflictError(entityType, entityId, expected, actual);
  }
}

/**
 * Converte OptimisticLockConflictError para TRPCError CONFLICT (HTTP 409).
 */
export function toTrpcConflict(err: OptimisticLockConflictError): TRPCError {
  return new TRPCError({ code: "CONFLICT", message: err.message });
}

/**
 * Retorna o próximo número de versão para um UPDATE bem-sucedido.
 */
export function nextVersion(current: number): number {
  return current + 1;
}

/**
 * Gera um ETag para uso em headers HTTP If-Match / ETag.
 * Formato: "<entityType>-<id>-v<version>"
 */
export function toETag(
  entityType: string,
  id: string | number,
  version: number,
): string {
  return `"${entityType}-${id}-v${version}"`;
}

/**
 * Parseia um ETag gerado por toETag.
 * Retorna null se o formato for inválido.
 */
export function parseETag(
  etag: string,
): { entityType: string; id: string; version: number } | null {
  const raw = etag.replace(/^"|"$/g, "");
  // Formato: <entityType>-<id>-v<version>
  // entityType pode conter hífens, então fazemos match guloso do prefix
  const match = raw.match(/^(.+)-([^-]+)-v(\d+)$/);
  if (!match) return null;
  const version = parseInt(match[3], 10);
  if (isNaN(version)) return null;
  return { entityType: match[1], id: match[2], version };
}

/**
 * Valida o header If-Match contra a versão atual da entidade.
 * Silencioso se o header estiver ausente (sem ETag = sem enforcement).
 */
export function checkIfMatch(
  ifMatchHeader: string | undefined,
  entityType: string,
  id: string | number,
  currentVersion: number,
): void {
  if (!ifMatchHeader) return;
  const parsed = parseETag(ifMatchHeader);
  if (!parsed) return;
  assertVersion(parsed.version, currentVersion, entityType, id);
}
