/**
 * Explainability de INTEGRIDADE do modelo (Template Governance V2). Distingue, sem misturar, o que é:
 *  - DECLARADO por quem registrou (hash da fonte jurídica) — NÃO é prova criptográfica verificada pelo servidor;
 *  - CALCULADO pelo servidor sobre o arquivo recebido (SHA-256 do original, preservado e reverificável);
 *  - DERIVADO pelo servidor do conteúdo canônico (hash semântico da revisão);
 *  - VERSIONADO pela plataforma (pacote aprovado no servidor);
 *  - e a procedência/lineage (de onde veio, com o que foi comparado).
 * Função pura e determinística: só descreve e compara — nunca altera estado nem promove uma declaração a prova.
 */
import type { ImportProvenance } from "./importProvenance";
import type { LegalApprovalEvidence } from "./legalEvidence";

export type HashAssurance = "CLIENT_DECLARED_UNVERIFIED" | "SERVER_COMPUTED" | "SERVER_DERIVED" | "PLATFORM_VERSIONED";
export type IntegrityItemId = "DECLARED_SOURCE_SHA256" | "SERVER_FILE_SHA256" | "SEMANTIC_HASH" | "LEGAL_EVIDENCE_SOURCE_SHA256" | "LINEAGE_REFERENCE";
export type IntegrityRelationId = "DECLARED_VS_FILE" | "DECLARED_VS_EVIDENCE" | "SEMANTIC_VS_PROVENANCE" | "LINEAGE_SOURCE" | "CONTENT_VS_LINEAGE";

export interface IntegrityItem {
  readonly id: IntegrityItemId; readonly label: string; readonly value: string | null; readonly assurance: HashAssurance; readonly explanation: string;
}
export interface IntegrityRelation {
  readonly id: IntegrityRelationId; readonly status: "MATCH" | "DIFFERENT" | "NOT_APPLICABLE" | "UNKNOWN"; readonly message: string;
}
/** O que o serviço conseguiu verificar AGORA sobre a origem do lineage (leitura tenant-scoped). `null` = não verificável (origem ausente/indisponível). */
export type LineageProbe =
  | { readonly kind: "PLATFORM_PACKAGE"; readonly currentPackageSha256: string | null }
  | { readonly kind: "TENANT_REVISION"; readonly sourceRevisionSemanticHash: string | null };

export interface IntegrityExplanation {
  readonly items: readonly IntegrityItem[];
  readonly relations: readonly IntegrityRelation[];
  /** Ids dos itens que o SERVIDOR calculou/derivou/versionou (nunca inclui declarações do cliente). */
  readonly serverAssured: readonly IntegrityItemId[];
  readonly notices: readonly string[];
}

const short = (h: string): string => `${h.slice(0, 12)}…`;

export function explainIntegrity(input: {
  readonly revisionSemanticHash: string;
  readonly provenance: ImportProvenance | null;
  readonly legalEvidence: LegalApprovalEvidence | null;
  readonly lineageProbe: LineageProbe | null;
}): IntegrityExplanation {
  const { provenance: p, legalEvidence: ev, revisionSemanticHash } = input;
  const items: IntegrityItem[] = [];
  const relations: IntegrityRelation[] = [];
  const origin = p?.origin ?? null;
  const isPlatformPackage = origin?.ownership === "PLATFORM";

  if (p) {
    items.push({
      id: "DECLARED_SOURCE_SHA256", label: "Hash declarado da fonte", value: p.sourceSha256,
      assurance: isPlatformPackage ? "PLATFORM_VERSIONED" : "CLIENT_DECLARED_UNVERIFIED",
      explanation: isPlatformPackage
        ? "Vem do pacote aprovado e versionado no servidor da plataforma (não foi digitado)."
        : "Informado por quem registrou o modelo. O servidor NÃO o verificou contra a fonte jurídica: é uma declaração, não uma prova criptográfica.",
    });
  }
  if (origin?.original) {
    items.push({
      id: "SERVER_FILE_SHA256", label: "Hash calculado do arquivo enviado", value: origin.original.sha256, assurance: "SERVER_COMPUTED",
      explanation: `Calculado pelo servidor sobre os ${origin.original.sizeBytes} bytes recebidos; o original foi preservado e reverificado por leitura de volta (${origin.original.preservation}). Pode ser reconferido a qualquer momento.`,
    });
  }
  items.push({
    id: "SEMANTIC_HASH", label: "Hash semântico do modelo", value: revisionSemanticHash, assurance: "SERVER_DERIVED",
    explanation: "Calculado pelo servidor sobre o conteúdo canônico (estrutura) da revisão. Independe dos bytes do arquivo e do hash declarado; identifica exatamente esta revisão imutável.",
  });
  if (ev) {
    items.push({
      id: "LEGAL_EVIDENCE_SOURCE_SHA256", label: "Hash da fonte na evidência jurídica", value: ev.sourceSha256, assurance: "CLIENT_DECLARED_UNVERIFIED",
      explanation: "Declarado ao registrar a evidência de análise jurídica externa. Registra o que foi informado; não comprova o parecer nem foi verificado pelo servidor.",
    });
  }
  if (origin?.lineage) {
    const l = origin.lineage;
    items.push(l.kind === "PLATFORM_PACKAGE"
      ? { id: "LINEAGE_REFERENCE", label: "Lineage: pacote da plataforma", value: l.sourceSha256, assurance: "PLATFORM_VERSIONED", explanation: `Derivado do pacote ${l.packageKey} v${l.packageVersion}, versionado no servidor.` }
      : { id: "LINEAGE_REFERENCE", label: "Lineage: revisão do próprio órgão", value: l.semanticHash, assurance: "SERVER_DERIVED", explanation: `Derivado da revisão ${l.revisionId} (hash semântico no momento da derivação).` });
  }

  // relações
  if (p && origin?.original) {
    relations.push(p.sourceSha256 === origin.original.sha256
      ? { id: "DECLARED_VS_FILE", status: "MATCH", message: "O hash declarado coincide com o calculado sobre o arquivo enviado: a declaração está confirmada PARA ESTE ARQUIVO (isso não comprova aprovação jurídica da fonte)." }
      : { id: "DECLARED_VS_FILE", status: "DIFFERENT", message: `O hash declarado (${short(p.sourceSha256)}) difere do calculado sobre o arquivo (${short(origin.original.sha256)}). Não é necessariamente erro: a declaração se refere à fonte jurídica informada e não foi verificada; o calculado se refere ao arquivo recebido.` });
  } else relations.push({ id: "DECLARED_VS_FILE", status: "NOT_APPLICABLE", message: "Sem arquivo enviado: não há hash calculado de arquivo para comparar com o declarado." });

  if (p && ev) {
    relations.push(p.sourceSha256 === ev.sourceSha256
      ? { id: "DECLARED_VS_EVIDENCE", status: "MATCH", message: "A evidência jurídica declara o mesmo hash de fonte da procedência (consistência entre duas declarações; nenhuma é prova verificada)." }
      : { id: "DECLARED_VS_EVIDENCE", status: "DIFFERENT", message: "A evidência jurídica declara um hash de fonte diferente do da procedência: ela não cobre esta fonte." });
  } else relations.push({ id: "DECLARED_VS_EVIDENCE", status: "NOT_APPLICABLE", message: ev ? "Sem procedência para comparar." : "Nenhuma evidência jurídica registrada (opcional ou obrigatória conforme a política do órgão)." });

  if (p) {
    relations.push(p.revisionSemanticHash === revisionSemanticHash
      ? { id: "SEMANTIC_VS_PROVENANCE", status: "MATCH", message: "O conteúdo da revisão é o mesmo importado (hash semântico igual ao registrado na procedência)." }
      : { id: "SEMANTIC_VS_PROVENANCE", status: "DIFFERENT", message: "O conteúdo da revisão difere do importado: foi adaptado depois da procedência registrada. A procedência descreve a origem, não o conteúdo atual." });
  } else relations.push({ id: "SEMANTIC_VS_PROVENANCE", status: "NOT_APPLICABLE", message: "Sem procedência registrada." });

  const l = origin?.lineage ?? null;
  const probe = input.lineageProbe;
  if (l && probe && l.kind === probe.kind) {
    if (l.kind === "TENANT_REVISION" && probe.kind === "TENANT_REVISION") {
      relations.push(probe.sourceRevisionSemanticHash === null
        ? { id: "LINEAGE_SOURCE", status: "UNKNOWN", message: "A revisão de origem não está acessível neste órgão; o lineage permanece registrado mas não pôde ser reverificado." }
        : probe.sourceRevisionSemanticHash === l.semanticHash
          ? { id: "LINEAGE_SOURCE", status: "MATCH", message: "A revisão de origem continua intacta (hash semântico igual ao registrado no lineage)." }
          : { id: "LINEAGE_SOURCE", status: "DIFFERENT", message: "O hash semântico da revisão de origem difere do registrado no lineage — integridade da origem comprometida; acione a administração." });
      relations.push(revisionSemanticHash === l.semanticHash
        ? { id: "CONTENT_VS_LINEAGE", status: "MATCH", message: "O conteúdo ainda é idêntico ao da origem (ainda não adaptado)." }
        : { id: "CONTENT_VS_LINEAGE", status: "DIFFERENT", message: "O conteúdo foi adaptado em relação à origem (esperado numa derivada); a origem não foi alterada." });
    } else if (l.kind === "PLATFORM_PACKAGE" && probe.kind === "PLATFORM_PACKAGE") {
      relations.push(probe.currentPackageSha256 === null
        ? { id: "LINEAGE_SOURCE", status: "UNKNOWN", message: "O pacote da plataforma de origem não está mais disponível; o lineage permanece registrado." }
        : probe.currentPackageSha256 === l.sourceSha256
          ? { id: "LINEAGE_SOURCE", status: "MATCH", message: "O pacote da plataforma de origem está na mesma versão registrada no lineage." }
          : { id: "LINEAGE_SOURCE", status: "DIFFERENT", message: "A plataforma publicou nova versão deste pacote; esta cópia continua derivada da versão registrada (nenhuma alteração automática)." });
    }
  } else if (l) relations.push({ id: "LINEAGE_SOURCE", status: "UNKNOWN", message: "O lineage não pôde ser reverificado agora." });

  return {
    items, relations,
    serverAssured: items.filter((i) => i.assurance !== "CLIENT_DECLARED_UNVERIFIED").map((i) => i.id),
    notices: [
      "Hashes DECLARADOS por pessoas não são provas criptográficas verificadas: só os itens marcados como calculados, derivados ou versionados pelo servidor/plataforma o são.",
      "Hash declarado da fonte, hash calculado do arquivo e hash semântico são coisas distintas e podem legitimamente diferir; as relações abaixo explicam cada comparação.",
    ],
  };
}
