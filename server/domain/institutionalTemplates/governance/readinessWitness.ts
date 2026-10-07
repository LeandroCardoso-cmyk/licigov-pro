/**
 * TESTEMUNHA DE PRONTIDÃO (TPL-ED-PUB-TOCTOU-001) — domínio puro e determinístico.
 *
 * A matriz de prontidão é calculada ANTES da transação de publicação, a partir de estado autoritativo (revisão, procedência,
 * evidência jurídica, catálogo, capacidades, inventário). Entre o cálculo e o COMMIT esse estado pode mudar (ex.: nova
 * evidência/procedência registrada por outra pessoa). A testemunha identifica EXATAMENTE o estado em que a matriz foi provada;
 * dentro da transação (com a linha da revisão travada) o estado é relido e comparado: divergiu ⇒ `READINESS_STALE` + ROLLBACK
 * TOTAL (zero decisão, zero transição, zero evento).
 *
 * Os registros de procedência/evidência são append-only e seus ids são determinísticos por (tenant, assunto, versão): comparar o
 * id da decisão corrente equivale a comparar versão E conteúdo. Nada aqui lê relógio.
 */
import { templateHash } from "../semanticHash";

export const READINESS_WITNESS_VERSION = "tpl-readiness-witness/1" as const;

/** Referências que a TRANSAÇÃO consegue reler (ledger + linha da revisão). */
export interface ReadinessWitnessRefs {
  readonly revisionSemanticHash: string;
  /** Id da decisão CORRENTE de procedência usada na matriz (`null` = nenhuma). */
  readonly provenanceDecisionId: string | null;
  /** Id da decisão CORRENTE de evidência jurídica usada na matriz (`null` = nenhuma). */
  readonly legalEvidenceDecisionId: string | null;
}

export interface ReadinessWitness extends ReadinessWitnessRefs {
  readonly version: typeof READINESS_WITNESS_VERSION;
  readonly revisionId: string;
  readonly catalogVersion: string;
  readonly catalogHash: string | null;
  readonly capabilitiesHash: string;
  /** Hash do inventário efetivamente usado (`null` = nenhum). */
  readonly inventoryHash: string | null;
  readonly matrixHash: string;
  /** Hash de todo o conteúdo acima (para a decisão de publicação citar). */
  readonly witnessHash: string;
}

export function buildReadinessWitness(input: Omit<ReadinessWitness, "version" | "witnessHash">): ReadinessWitness {
  const base = { version: READINESS_WITNESS_VERSION, ...input };
  return Object.freeze({ ...base, witnessHash: templateHash(base) });
}

export function witnessRefs(w: ReadinessWitness): ReadinessWitnessRefs {
  return { revisionSemanticHash: w.revisionSemanticHash, provenanceDecisionId: w.provenanceDecisionId, legalEvidenceDecisionId: w.legalEvidenceDecisionId };
}

/** Compara o estado RELIDO na transação com o da testemunha. Devolve os campos divergentes (vazio = íntegro). */
export function witnessDrift(expected: ReadinessWitnessRefs, current: ReadinessWitnessRefs): string[] {
  const out: string[] = [];
  if (expected.revisionSemanticHash !== current.revisionSemanticHash) out.push("revisionSemanticHash");
  if (expected.provenanceDecisionId !== current.provenanceDecisionId) out.push("provenance");
  if (expected.legalEvidenceDecisionId !== current.legalEvidenceDecisionId) out.push("legalEvidence");
  return out;
}
