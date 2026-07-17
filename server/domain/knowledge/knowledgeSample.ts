/**
 * RC-4.7 — Institutional Knowledge Framework · Amostra estrutural.
 *
 * Documento de conhecimento GENÉRICO de exemplo (texto placeholder — NENHUM conteúdo jurídico),
 * usado para exercitar blocos, qualidade, renderer, lifecycle, versionamento, registry e projeção.
 * Determinístico.
 */

import { createBlock } from "./knowledgeBlocks";
import { createSection, createKnowledgeDocument, createReference, createRelationship, type KnowledgeDocument } from "./knowledgeDocument";

const T = "2026-01-01T00:00:00.000Z";

/**
 * Documento de exemplo com múltiplos blocos cobrindo os recomendados + extras. Genérico.
 * `lifecycleState` e `revision` parametrizáveis para exercitar o ciclo/versionamento.
 */
export function sampleKnowledgeDocument(tenantId: number, docKey = "doc-exemplo"): KnowledgeDocument {
  const frag = (text: string) => ({ text });

  const secResumo = createSection({
    docKey, title: "Visão Geral", order: 1, blocks: [
      createBlock({ docKey, kind: "ExecutiveSummary", order: 1, fragments: [frag("Resumo executivo de exemplo (estrutura).")] }),
      createBlock({ docKey, kind: "PlainLanguage", order: 2, fragments: [frag("Explicação em linguagem simples (estrutura).")] }),
    ],
  });
  const secAplicacao = createSection({
    docKey, title: "Aplicação", order: 2, blocks: [
      createBlock({ docKey, kind: "Applicability", order: 1, fragments: [frag("Quando se aplica (estrutura).")] }),
      createBlock({ docKey, kind: "Requirements", order: 2, fragments: [frag("Requisitos (estrutura).")] }),
      createBlock({ docKey, kind: "Checklist", order: 3, fragments: [frag("Item de checklist (estrutura).")] }),
      createBlock({ docKey, kind: "Risk", order: 4, fragments: [frag("Risco de exemplo (estrutura).")] }),
    ],
  });
  const secApoio = createSection({
    docKey, title: "Apoio", order: 3, blocks: [
      createBlock({ docKey, kind: "FAQ", order: 1, fragments: [frag("Pergunta frequente (estrutura).")] }),
      createBlock({ docKey, kind: "Explainability", order: 2, fragments: [frag("Explicação de origem (estrutura).")] }),
    ],
  });

  return createKnowledgeDocument({
    tenantId, docKey, title: "Documento de Conhecimento (exemplo)",
    sections: [secResumo, secAplicacao, secApoio],
    references: [createReference({ from: docKey, to: "doc-relacionado", type: "relates_to", explanation: "Relação de exemplo." })],
    relationships: [createRelationship({ source: docKey, target: "doc-pai", type: "child", explanation: "Filho de um documento pai (exemplo)." })],
    semver: "1.0.0", revision: 1, lifecycleState: "draft", createdAt: T, updatedAt: T,
  });
}
