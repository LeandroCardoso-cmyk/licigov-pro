/**
 * Capacidades REAIS do sistema para compor modelos (fatos, não promessas) — usadas pela matriz de prontidão. Declaradas em
 * código e substituíveis por port (a integração Lane A/B atualiza este contrato quando uma capacidade passa a existir).
 * Capacidade ausente ⇒ BLOCKED na matriz; nunca é omitida nem "assumida".
 */
import type { VariableSource } from "../variableCatalog";
import { PERSISTED_SCOPE_DIMENSIONS_V0316, type ScopeDimension } from "./scopeDimensions";

export type CapabilitySource = VariableSource | "CERTAME_CONFIG";

export interface TemplateCapabilities {
  /** Fonte canônica com backing no `CanonicalReferencePort` real? */
  readonly sources: Readonly<Record<CapabilitySource, boolean>>;
  /** `docRef` com pin EXATO (documento + linhagem + versão + hash) de versão oficial emitida. */
  readonly trExactPin: boolean;
  /** Existe produtor automático de narrativas de IA para slots de modelo? (o aceite humano exato existe independentemente) */
  readonly aiNarrativeProducer: boolean;
  /** Dimensões de escopo que a persistência de bindings consegue gravar. */
  readonly scopeDimensions: readonly ScopeDimension[];
}

/**
 * Estado verificado em `main@d4bb209`: PROCESS/IDENTITY/DFD/ETP/TR/PARAMS resolvem; ITEMS lança `TemplatePersistenceUnavailableError`
 * (sem backing); não existe fonte CERTAME_CONFIG; o produtor de IA para modelos é fase posterior; binding grava 3 dimensões.
 */
export const BASELINE_CAPABILITIES_D4BB209: TemplateCapabilities = Object.freeze({
  sources: Object.freeze({
    PROCESS: true, DFD: true, ETP: true, TR: true, PARAMS: true, IDENTITY: true, ITEMS: false, CERTAME_CONFIG: false,
  }) as Readonly<Record<CapabilitySource, boolean>>,
  trExactPin: true,
  aiNarrativeProducer: false,
  scopeDimensions: PERSISTED_SCOPE_DIMENSIONS_V0316,
});
