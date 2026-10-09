/**
 * Bridge Edital → Modelos Institucionais (UI) — lógica pura, sem React/rede. O SERVIDOR decide o motor
 * (`generateNotice` roteia); aqui só se exibe a resolução autoritativa e se bloqueia a ação quando é obrigatório.
 */
export type TemplateResolutionView =
  | { status: "FEATURE_OFF" }
  | { status: "NOT_BOUND"; reason: "NO_BINDING" | "UNMAPPED_SCOPE" | "PARAMETERS_INCOMPLETE"; detail?: string }
  | { status: "BOUND"; template: { bindingId: string; identityId: string; displayName: string; revisionId: string; revision: number; semanticHash: string; scope: Record<string, string | undefined> } }
  | { status: "CONFLICT"; bindingIds: readonly string[] }
  | { status: "INVALID"; codes: readonly string[] };

export interface TrCandidateView {
  documentId: string; title: string; version: number; contentHash: string; status: string; createdAt: string; current: boolean;
}

export const NOT_BOUND_MESSAGE =
  "Nenhum modelo institucional publicado está vinculado a este escopo. A geração seguirá o fluxo governado atual.";
export const TR_OFICIAL_EXATO_NECESSARIO = "TR_OFICIAL_EXATO_NECESSARIO";
export const TR_REQUIRED_MESSAGE = "Para gerar com o modelo institucional é necessário confirmar um TR oficial emitido (versão exata). Emita o TR oficial deste processo antes.";

const SCOPE_LABEL: Record<string, string> = {
  pregao: "Pregão", concorrencia: "Concorrência", leilao: "Leilão", concurso: "Concurso", "chamada-publica": "Chamada Pública",
  credenciamento: "Credenciamento", "registro-de-precos": "Registro de Preços", eletronica: "Eletrônica", presencial: "Presencial",
  bll: "BLL", "compras-gov": "Compras.gov.br", licitanet: "Licitanet", propria: "Portal próprio",
};

export const scopeLabel = (scope: Record<string, string | undefined>): string =>
  (["modality", "form", "platform"] as const).map((k) => scope[k]).filter((v): v is string => !!v).map((v) => SCOPE_LABEL[v] ?? v).join(" · ");

export const shortHash = (hash: string): string => hash.slice(0, 8);

/** Pin exato do TR enviado ao servidor: SÓ o candidato vigente, escolhido por pessoa; o hash vem do servidor. */
export function trPinOf(candidate: TrCandidateView | undefined | null) {
  return candidate && candidate.current ? { documentId: candidate.documentId, version: candidate.version, contentHash: candidate.contentHash } : null;
}

/** A geração pode prosseguir? CONFLICT/INVALID bloqueiam; BOUND exige o TR exato confirmado; demais estados seguem o fluxo atual. */
export function bridgeAllowsGeneration(resolution: TemplateResolutionView | undefined, trPin: ReturnType<typeof trPinOf>): { allowed: boolean; reason?: string } {
  if (!resolution) return { allowed: true };
  if (resolution.status === "CONFLICT") return { allowed: false, reason: "Mais de um vínculo vigente para este escopo: nenhum modelo é escolhido automaticamente." };
  if (resolution.status === "INVALID") return { allowed: false, reason: `Vínculo do modelo institucional inválido (${resolution.codes.join(", ")}).` };
  if (resolution.status === "BOUND" && !trPin) return { allowed: false, reason: TR_REQUIRED_MESSAGE };
  return { allowed: true };
}
