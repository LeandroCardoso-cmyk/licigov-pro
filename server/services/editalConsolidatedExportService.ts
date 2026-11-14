/**
 * F2 — Resolução da fonte da EXPORTAÇÃO CONSOLIDADA do Edital (Edital emitido + TR oficial integral no Anexo I).
 *
 * A única fonte do TR é o PIN gravado no Issuance Manifest (M2) da versão emitida do Edital (`officialDocRefs`): o mesmo documento,
 * versão e hash que a revalidação conferiu no ato da emissão. Nunca o rascunho do TR, nunca "o último TR", nunca outro processo/órgão,
 * nunca texto regenerado. Fail-closed em qualquer divergência (o pacote não é produzido "incompleto como se fosse completo"):
 *  - Edital: mesmo órgão (leitura tenant-scoped), processo licitatório, tipo `edital`, status `emitido`;
 *  - M2: existe neste órgão, é ISSUANCE desta versão (`officialDocumentId`) e o seu `documentContentHash` é o hash do conteúdo
 *    oficial do Edital (o hash do M2 é revalidado na leitura — `rowsToManifest`);
 *  - TR: exatamente UMA referência a TR no M2; o documento é do mesmo órgão, mesmo processo (`origin`), tipo `tr`, `emitido`, e
 *    linhagem/versão/sha256 do conteúdo coincidem com o pin.
 * Somente LEITURA: não grava, não versiona, não altera nenhum documento ou manifest. Sem IA.
 */
import { TRPCError } from "@trpc/server";
import { getManifest } from "../db/institutionalTemplates";
import { getOfficialDocument, listVersions } from "../db/officialDocuments";
import { sha256Hex } from "../domain/canonicalJson";
import { formatBrazilianDateTime } from "../domain/brazilianDateTime";
import { consolidateEditalWithTr, type ConsolidationTr } from "../domain/editalConsolidation";
import type { OfficialDocument } from "../domain/officialDocument";

export const EDITAL_TR_LINK_UNAVAILABLE = "EDITAL_TR_LINK_UNAVAILABLE";
export const EDITAL_TR_SOURCE_UNVERIFIABLE = "EDITAL_TR_SOURCE_UNVERIFIABLE";

const DOMAIN = "processo_licitatorio";

const refuse = (code: string, detail: string): TRPCError => new TRPCError({
  code: "PRECONDITION_FAILED",
  message: `${code}: não foi possível montar o Edital completo — ${detail}. Exporte o Edital e o Termo de Referência separadamente; nada foi alterado.`,
});

export interface ConsolidatedEditalSource {
  readonly content: string;
  readonly tr: { readonly documentId: string; readonly lineageId: string; readonly version: number; readonly contentHash: string; readonly emissionNumber: number };
  readonly issuanceManifestId: string;
}

async function emissionNumberOf(doc: OfficialDocument, organizationId: number): Promise<number> {
  return (await listVersions(doc.lineageId, organizationId)).filter((v) => v.status === "emitido" && v.version <= doc.version).length;
}

/** Conteúdo consolidado de UMA versão emitida do Edital (`edital` já lido tenant-scoped pelo chamador). */
export async function resolveConsolidatedEdital(edital: OfficialDocument, organizationId: number): Promise<ConsolidatedEditalSource> {
  if (edital.tenantId !== organizationId || edital.businessDomain !== DOMAIN || edital.documentType !== "edital" || edital.status !== "emitido") {
    throw refuse(EDITAL_TR_LINK_UNAVAILABLE, "o Edital completo só é gerado a partir de uma versão emitida do Edital");
  }
  const meta = (edital.metadata ?? {}) as Record<string, unknown>;
  const m2Id = typeof meta.templateIssuanceManifestId === "string" ? meta.templateIssuanceManifestId : "";
  if (!m2Id) throw refuse(EDITAL_TR_LINK_UNAVAILABLE, "esta versão do Edital não registra o vínculo com uma versão oficial do Termo de Referência");

  // Manifest ilegível/corrompido (hash não confere na leitura) ⇒ recusa explícita, nunca 500 genérico nem substituição.
  const stored = await getManifest(organizationId, m2Id).catch(() => {
    throw refuse(EDITAL_TR_SOURCE_UNVERIFIABLE, "o registro da emissão do Edital não pôde ser verificado");
  });
  const m2 = stored?.manifest;
  if (!stored || !m2 || m2.stage !== "ISSUANCE" || stored.officialDocumentId !== edital.id || m2.organizationId !== organizationId
      || m2.documentContentHash !== sha256Hex(edital.content)) {
    throw refuse(EDITAL_TR_SOURCE_UNVERIFIABLE, "o registro da emissão do Edital não confere com a versão oficial");
  }

  // Exatamente UMA referência a TR (o tipo vem do documento oficial apontado — o pin não carrega o tipo).
  const candidates: OfficialDocument[] = [];
  const refsByDoc = new Map(m2.officialDocRefs.map((r) => [r.documentId, r]));
  for (const ref of m2.officialDocRefs) {
    const doc = await getOfficialDocument(ref.documentId, organizationId);
    if (doc && doc.documentType === "tr") candidates.push(doc);
  }
  if (candidates.length !== 1) {
    throw refuse(EDITAL_TR_SOURCE_UNVERIFIABLE, candidates.length === 0
      ? "a versão oficial do Termo de Referência vinculada não foi encontrada neste órgão"
      : "a emissão do Edital referencia mais de um Termo de Referência");
  }
  const tr = candidates[0];
  const pin = refsByDoc.get(tr.id)!;
  if (tr.tenantId !== organizationId || tr.businessDomain !== DOMAIN || tr.origin !== edital.origin || tr.status !== "emitido"
      || tr.lineageId !== pin.lineageId || tr.version !== pin.version || sha256Hex(tr.content ?? "") !== pin.contentHash) {
    throw refuse(EDITAL_TR_SOURCE_UNVERIFIABLE, "a versão oficial do Termo de Referência não confere com a versão fixada na emissão do Edital");
  }

  const emissionNumber = await emissionNumberOf(tr, organizationId);
  const createdAt = new Date(tr.createdAt);
  const source: ConsolidationTr = {
    documentId: tr.id, version: tr.version, emissionNumber, contentHash: pin.contentHash, content: tr.content,
    emittedAtLabel: Number.isNaN(createdAt.getTime()) ? "data não registrada" : formatBrazilianDateTime(createdAt),
  };
  const out = consolidateEditalWithTr(edital.content, source);
  if (!out.ok) throw refuse(out.code, out.message);
  return {
    content: out.content, issuanceManifestId: m2.id,
    tr: { documentId: tr.id, lineageId: tr.lineageId, version: tr.version, contentHash: pin.contentHash, emissionNumber },
  };
}
