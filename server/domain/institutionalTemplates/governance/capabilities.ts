/**
 * Capacidades REAIS do sistema para compor modelos (fatos, não promessas) — usadas pela matriz de prontidão. Declaradas em
 * código e substituíveis por port. Capacidade ausente ⇒ BLOCKED na matriz; nunca é omitida nem "assumida".
 *
 * Estado integrado (Lane A + B + C):
 *  - todas as fontes do catálogo `tpl-catalog/2` têm adapter canônico real (ITEMS = Itens da contratação; CERTAME_CONFIG/POLICY/
 *    PROCESS/TR/NORMATIVE/BUDGET/LIFECYCLE = campos governados por decisão humana + autoridades do domínio);
 *  - RESULT não tem autoridade no pré-certame: só é admissível quando TODAS as variáveis RESULT usadas são opcionais (o texto
 *    governado "a preencher" substitui o valor) — `OPTIONAL_ONLY`; nunca é inventada;
 *  - o pin exato do documento oficial (TR) existe; o produtor automático de narrativas de IA para modelos NÃO existe (as
 *    execuções entram por id auditável e exigem aceite humano exato);
 *  - o binding persiste as cinco dimensões do escopo exato (migration 0317).
 */
import type { VariableSource2 } from "../variableCatalog2";
import { PERSISTED_SCOPE_DIMENSIONS, type ScopeDimension } from "./scopeDimensions";

export type CapabilitySource = VariableSource2;
export type SourceCapability = boolean | "OPTIONAL_ONLY";

export interface TemplateCapabilities {
  /** Fonte canônica com backing no `CanonicalReferencePort` real? */
  readonly sources: Readonly<Record<CapabilitySource, SourceCapability>>;
  /** `docRef` com pin EXATO (documento + linhagem + versão + hash) de versão oficial emitida. */
  readonly trExactPin: boolean;
  /** Existe produtor automático de narrativas de IA para slots de modelo? (o aceite humano exato existe independentemente) */
  readonly aiNarrativeProducer: boolean;
  /** Dimensões de escopo que a persistência de bindings consegue gravar. */
  readonly scopeDimensions: readonly ScopeDimension[];
}

export const INTEGRATED_CAPABILITIES: TemplateCapabilities = Object.freeze({
  sources: Object.freeze({
    PROCESS: true, DFD: true, ETP: true, TR: true, PARAMS: true, IDENTITY: true, ITEMS: true, CERTAME_CONFIG: true,
    POLICY: true, BUDGET: true, NORMATIVE: true, LIFECYCLE: true, RESULT: "OPTIONAL_ONLY",
  }) as Readonly<Record<CapabilitySource, SourceCapability>>,
  trExactPin: true,
  aiNarrativeProducer: false,
  scopeDimensions: PERSISTED_SCOPE_DIMENSIONS,
});

/** Estado verificado em `main@d4bb209` (histórico; usado só por testes de regressão da matriz). */
export const BASELINE_CAPABILITIES_D4BB209: TemplateCapabilities = Object.freeze({
  sources: Object.freeze({
    PROCESS: true, DFD: true, ETP: true, TR: true, PARAMS: true, IDENTITY: true, ITEMS: false, CERTAME_CONFIG: false,
    POLICY: false, BUDGET: false, NORMATIVE: false, LIFECYCLE: false, RESULT: false,
  }) as Readonly<Record<CapabilitySource, SourceCapability>>,
  trExactPin: true,
  aiNarrativeProducer: false,
  scopeDimensions: ["modality", "regime", "criterion"] as readonly ScopeDimension[],
});
