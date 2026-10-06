/**
 * Institutional Document Templates — camada de persistência (T2). Tenant-scoped em toda operação; escritas exigem TRANSAÇÃO
 * (HD-26: validação de pais existentes por id + tenant na MESMA transação). Sem router, UI ou composer aqui: os serviços
 * (workflow, composição, emissão) consomem estes repositórios por ports/adapters — ver
 * `docs/architecture/INSTITUTIONAL_TEMPLATES_INTEGRATION.md`.
 */
export * from "./errors";
export * from "./executor";
export * from "./existingParents";
export * from "./events";
export * from "./identities";
export * from "./revisions";
export * from "./bindings";
export * from "./manifests";
