import { createHash } from "crypto";

export type LegalReferenceType =
  | "lei"
  | "decreto"
  | "portaria"
  | "resolucao"
  | "acordao"
  | "parecer"
  | "sumula"
  | "jurisprudencia";

export type LegalVigencia = "vigente" | "revogada" | "parcialmente_revogada";

export interface LegalReferenceNode {
  readonly id: string;
  readonly organizationId: number;
  readonly referenceType: LegalReferenceType;
  readonly numero: string;
  readonly ano: number;
  readonly orgao: string;
  readonly artigo: string | null;
  readonly inciso: string | null;
  readonly alinea: string | null;
  readonly texto: string;
  readonly vigencia: LegalVigencia;
  readonly ementa: string;
  readonly createdAt: string;
}

export function createLegalReference(params: {
  organizationId: number;
  referenceType: LegalReferenceType;
  numero: string;
  ano: number;
  orgao: string;
  texto: string;
  artigo?: string | null;
  inciso?: string | null;
  alinea?: string | null;
  vigencia?: LegalVigencia;
  ementa?: string;
}): LegalReferenceNode {
  const id = createHash("sha256")
    .update(`lr:${params.organizationId}:${params.referenceType}:${params.numero}:${params.ano}:${params.artigo ?? ""}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    referenceType: params.referenceType,
    numero: params.numero,
    ano: params.ano,
    orgao: params.orgao,
    artigo: params.artigo ?? null,
    inciso: params.inciso ?? null,
    alinea: params.alinea ?? null,
    texto: params.texto,
    vigencia: params.vigencia ?? "vigente",
    ementa: params.ementa ?? "",
    createdAt: new Date().toISOString(),
  };
}

export function formatLegalCitation(ref: LegalReferenceNode): string {
  let citation = `${ref.referenceType === "lei" ? "Lei" : ref.referenceType === "decreto" ? "Decreto" : ref.referenceType === "acordao" ? "Acórdão" : ref.referenceType.charAt(0).toUpperCase() + ref.referenceType.slice(1)} nº ${ref.numero}/${ref.ano}`;
  if (ref.artigo) citation += `, Art. ${ref.artigo}`;
  if (ref.inciso) citation += `, Inc. ${ref.inciso}`;
  if (ref.alinea) citation += `, Al. ${ref.alinea}`;
  return citation;
}

export function isVigente(ref: LegalReferenceNode): boolean {
  return ref.vigencia === "vigente";
}
