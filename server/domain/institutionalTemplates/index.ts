/**
 * Institutional Document Templates — domínio puro da fase T1 (sem persistência, router, UI ou integração).
 * Ver `docs/architecture/INSTITUTIONAL_TEMPLATES_T1_DOMAIN.md`.
 */
export * from "./types";
export * from "./tenant";
export * from "./semanticHash";
export * from "./variableCatalog";
export * from "./conditionalDsl";
export * from "./ast";
export * from "./revision";
export * from "./binding";
export * from "./manifest";
export * from "./composerContract";
export * from "./governedSources";
// tpl-ast/2 · tpl-catalog/2 (paralelos ao v1; o v1 e o seu replay permanecem intactos)
export * from "./conditionalDsl2";
export * from "./variableCatalog2";
export * from "./ast2";
export * from "./astVersions";
export * from "./modelRules";
