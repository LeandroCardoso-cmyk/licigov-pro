/**
 * Institutional Document Templates — camada de persistência (T2). Tenant-scoped, sem router, sem UI, sem composer e sem
 * integração com o Document Engine/Lifecycle. Escritas exigem TRANSAÇÃO (HD-26: validação de pais existentes na mesma tx).
 */
export * from "./errors";
export * from "./executor";
export * from "./existingParents";
export * from "./events";
export * from "./identities";
export * from "./revisions";
export * from "./bindings";
export * from "./manifests";
