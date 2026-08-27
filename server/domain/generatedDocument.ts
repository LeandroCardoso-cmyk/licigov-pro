/**
 * Sprint 5.1 — Generated Documents (ETP, TR, Edital)
 *
 * Documentos são CONSEQUÊNCIA do processo, nunca o contrário. São construídos
 * automaticamente a partir do fluxo (DFD, ETP, pesquisa, itens, CATMAT, histórico,
 * copilotos) e o servidor REVISA. Determinístico.
 */

import { createHash } from "crypto";

export type DocumentKind = "dfd" | "etp" | "tr" | "edital";

export type DocumentStatus = "rascunho" | "em_revisao" | "aprovado";

/**
 * Hash determinístico do CONTEÚDO do rascunho — primitive ÚNICA de integridade compartilhada por toda
 * a superfície (C.4B.1 emissão, C.4B.2 review/pin, C.4B.3A edição/proveniência). Vive no domínio para
 * evitar duplicação do algoritmo e ciclos de import entre db/ e services/.
 */
export function draftContentHash(content: string): string {
  return createHash("sha256").update(content ?? "").digest("hex");
}

/**
 * DFD — Documento de Formalização da Demanda (art. 12, §1º da Lei 14.133/2021).
 *
 * "Criar DFD do zero": produz um RASCUNHO ESTRUTURADO e editável (não é uma
 * finalização automática). O servidor estrutura as seções obrigatórias a partir
 * do objeto; o usuário revisa/edita e salva. A geração ASSISTIDA POR IA plena
 * (enriquecimento do conteúdo pela porta de IA) fica como evolução — aqui a
 * capacidade production-ready mínima é a elaboração estruturada editável.
 */
export function buildDFDDraft(object: string): string {
  const obj = object.trim() || "[descrever o objeto]";
  return [
    "# DFD — Documento de Formalização da Demanda",
    "_Art. 12, §1º da Lei 14.133/2021 — rascunho estruturado (revisar e editar antes de prosseguir)._",
    "",
    "## 1. Identificação da demanda",
    `Objeto: ${obj}`,
    "Setor/unidade demandante: [preencher]",
    "Responsável pela demanda: [preencher]",
    "",
    "## 2. Justificativa da necessidade da contratação",
    `Descrever a necessidade pública que motiva a contratação de "${obj}", com o `,
    "problema a ser resolvido e o interesse público envolvido. [preencher]",
    "",
    "## 3. Descrição sucinta do objeto",
    `${obj} — detalhar características essenciais, natureza (bem/serviço) e finalidade. [preencher]`,
    "",
    "## 4. Quantitativo estimado e unidade",
    "Quantidade estimada: [preencher] · Unidade: [preencher]",
    "Memória de cálculo/critério da estimativa: [preencher]",
    "",
    "## 5. Previsão da contratação no planejamento",
    "Alinhamento ao Plano de Contratações Anual (PCA) e ao planejamento do órgão. [preencher]",
    "",
    "## 6. Estimativa preliminar de recursos orçamentários",
    "Indicar a previsão orçamentária preliminar, se disponível. [preencher]",
    "",
    "## 7. Grau de prioridade e prazo desejado",
    "Prioridade: [baixa/média/alta] · Prazo pretendido para a contratação: [preencher]",
    "",
    "> Rascunho gerado pelo sistema para estruturação da demanda. Revisão obrigatória",
    "> pelo servidor responsável antes de avançar para o ETP.",
  ].join("\n");
}

// ─── Edital: modalidade, forma e plataforma ──────────────────────────────────

export type EditalModality =
  | "pregao"
  | "concorrencia"
  | "leilao"
  | "concurso"
  | "chamada_publica"
  | "credenciamento"
  | "registro_de_precos";

export type EditalForm = "eletronico" | "presencial";

export type EditalPlatform =
  | "compras_gov"
  | "bll"
  | "licitanet"
  | "portal_proprio"
  | "outra";

export interface GeneratedDocument {
  readonly id: string;
  readonly processId: string;
  readonly organizationId: number;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly content: string;
  readonly status: DocumentStatus;
  /** Fontes que originaram o documento (rastreabilidade). */
  readonly sources: readonly string[];
  /** Somente para Edital. */
  readonly modality: EditalModality | null;
  readonly form: EditalForm | null;
  readonly platform: EditalPlatform | null;
  readonly legalJustification: string;
  /** C.4B.1 — autor do rascunho (quem gerou/originou). Base da segregação de deveres na emissão. */
  readonly authorUserId: number | null;
  /** C.4B.3A — último humano responsável por alteração material do conteúdo atual (edição/regeneração). */
  readonly lastSubstantiveActorUserId: number | null;
  readonly lastSubstantiveAt: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createGeneratedDocument(params: {
  processId: string;
  organizationId: number;
  kind: DocumentKind;
  title: string;
  content?: string;
  sources?: string[];
  modality?: EditalModality | null;
  form?: EditalForm | null;
  platform?: EditalPlatform | null;
  legalJustification?: string;
  authorUserId?: number | null;
  lastSubstantiveActorUserId?: number | null;
  lastSubstantiveAt?: string | null;
  correlationId: string;
  createdAt?: string;
}): GeneratedDocument {
  const id = createHash("sha256")
    .update(`gdoc:${params.organizationId}:${params.processId}:${params.kind}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    processId: params.processId,
    organizationId: params.organizationId,
    kind: params.kind,
    title: params.title,
    content: params.content ?? "",
    status: "rascunho",
    sources: params.sources ?? [],
    modality: params.modality ?? null,
    form: params.form ?? null,
    platform: params.platform ?? null,
    legalJustification: params.legalJustification ?? "",
    authorUserId: params.authorUserId ?? null,
    lastSubstantiveActorUserId: params.lastSubstantiveActorUserId ?? null,
    lastSubstantiveAt: params.lastSubstantiveAt ?? null,
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function approveDocument(doc: GeneratedDocument, at?: string): GeneratedDocument {
  return { ...doc, status: "aprovado", updatedAt: at ?? new Date().toISOString() };
}

/**
 * Regra do Edital: forma presencial EXIGE justificativa legal automática;
 * eletrônico EXIGE plataforma definida.
 */
export function validateEdital(doc: GeneratedDocument): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (doc.kind !== "edital") return { valid: true, violations };
  if (!doc.modality) violations.push("Edital sem modalidade definida.");
  if (!doc.form) violations.push("Edital sem forma (eletrônico/presencial).");
  if (doc.form === "presencial" && doc.legalJustification.trim().length === 0) {
    violations.push("Edital presencial exige justificativa legal.");
  }
  if (doc.form === "eletronico" && !doc.platform) {
    violations.push("Edital eletrônico exige plataforma definida.");
  }
  return { valid: violations.length === 0, violations };
}

/** Justificativa legal padrão para modalidade presencial (revisável pelo servidor). */
export function defaultPresencialJustification(modality: EditalModality): string {
  return `Justificativa para adoção da forma presencial na modalidade ${modality}, nos termos do art. 17, §2º da Lei 14.133/2021, a ser revisada e validada pelo servidor competente.`;
}
