/**
 * FASE 5 — Contratação Direta: rótulos e estilos compartilhados (pt-BR).
 */
import { statusTone } from "@/components/ui/statusStyles";

export const STAGE_LABELS: Record<string, string> = {
  NEW: "Nova",
  DFD: "DFD",
  LEGAL_BASIS: "Fundamento Legal",
  NEED_CHARACTERIZATION: "Caracterização da Necessidade",
  PRICE_RESEARCH: "Pesquisa de Preços",
  PROCEDURE: "Forma de Condução",
  PROPOSAL_COLLECTION: "Recebimento das Propostas",
  CONTRACT_JUSTIFICATION: "Justificativa da Contratação",
  PRICE_JUSTIFICATION: "Justificativa do Preço",
  REQUIRED_DOCUMENTS: "Documentação Obrigatória",
  LEGAL_OPINION: "Parecer Jurídico",
  RATIFICATION: "Ratificação",
  PUBLICATION: "Publicação",
  CONTRACT: "Contrato",
  ARCHIVED: "Arquivado",
};

export const STAGE_CLASSES: Record<string, string> = {
  NEW: "bg-muted text-foreground ring-gray-500/20",
  DFD: "bg-slate-100 text-slate-700 ring-slate-500/20",
  LEGAL_BASIS: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 ring-blue-500/20",
  NEED_CHARACTERIZATION: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 ring-blue-500/20",
  PRICE_RESEARCH: "bg-cyan-100 dark:bg-cyan-900 text-cyan-800 dark:text-cyan-200 ring-cyan-500/20",
  PROCEDURE: "bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 ring-indigo-500/20",
  PROPOSAL_COLLECTION: "bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 ring-indigo-500/20",
  CONTRACT_JUSTIFICATION: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 ring-purple-500/20",
  PRICE_JUSTIFICATION: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 ring-purple-500/20",
  REQUIRED_DOCUMENTS: "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 ring-amber-500/20",
  LEGAL_OPINION: "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 ring-yellow-500/20",
  RATIFICATION: "bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200 ring-teal-500/20",
  PUBLICATION: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 ring-green-500/20",
  CONTRACT: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 ring-green-500/20",
  ARCHIVED: "bg-muted text-muted-foreground ring-gray-500/20",
};

export const PROCUREMENT_TYPE_LABELS: Record<string, string> = {
  dispensa: "Dispensa de Licitação",
  inexigibilidade: "Inexigibilidade",
};

export const PROCEDURE_LABELS: Record<string, string> = {
  eletronico: "Eletrônico",
  presencial: "Presencial",
  indefinido: "Indefinido",
};

export const PLATFORM_LABELS: Record<string, string> = {
  compras_gov: "Compras.gov.br",
  bll: "BLL",
  licitanet: "Licitanet",
  portal_proprio: "Portal Próprio",
  outra: "Outra",
};

export const RECEIPT_LABELS: Record<string, string> = {
  email: "E-mail",
  protocolo: "Protocolo",
  entrega_presencial: "Entrega presencial",
  outro: "Outro",
};

export const DOC_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  anexado: "Anexado",
  validado: "Validado",
};

// V1 Visual Refinement (passagem 2): status semânticos usam a linguagem CANÔNICA de
// tons (statusTone) — mesma semântica ⇒ mesma cor entre módulos. As STAGE_CLASSES acima
// permanecem multi-hue de propósito (identidade de ETAPA do workflow, não status).
export const DOC_STATUS_CLASSES: Record<string, string> = {
  pendente: `${statusTone("danger")} ring-red-500/20`,
  anexado: `${statusTone("warning")} ring-amber-500/20`,
  validado: `${statusTone("success")} ring-green-500/20`,
};

export function stageLabel(code: string): string {
  return STAGE_LABELS[code] ?? code;
}

export function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
