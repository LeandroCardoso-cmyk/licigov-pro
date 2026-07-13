/**
 * FASE 5 — Contratação Direta: rótulos e estilos compartilhados (pt-BR).
 */

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
  NEW: "bg-gray-100 text-gray-700 ring-gray-500/20",
  DFD: "bg-slate-100 text-slate-700 ring-slate-500/20",
  LEGAL_BASIS: "bg-blue-100 text-blue-800 ring-blue-500/20",
  NEED_CHARACTERIZATION: "bg-blue-100 text-blue-800 ring-blue-500/20",
  PRICE_RESEARCH: "bg-cyan-100 text-cyan-800 ring-cyan-500/20",
  PROCEDURE: "bg-indigo-100 text-indigo-800 ring-indigo-500/20",
  PROPOSAL_COLLECTION: "bg-indigo-100 text-indigo-800 ring-indigo-500/20",
  CONTRACT_JUSTIFICATION: "bg-purple-100 text-purple-800 ring-purple-500/20",
  PRICE_JUSTIFICATION: "bg-purple-100 text-purple-800 ring-purple-500/20",
  REQUIRED_DOCUMENTS: "bg-amber-100 text-amber-800 ring-amber-500/20",
  LEGAL_OPINION: "bg-yellow-100 text-yellow-800 ring-yellow-500/20",
  RATIFICATION: "bg-teal-100 text-teal-800 ring-teal-500/20",
  PUBLICATION: "bg-green-100 text-green-800 ring-green-500/20",
  CONTRACT: "bg-green-100 text-green-800 ring-green-500/20",
  ARCHIVED: "bg-gray-100 text-gray-500 ring-gray-500/20",
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

export const DOC_STATUS_CLASSES: Record<string, string> = {
  pendente: "bg-red-100 text-red-700 ring-red-500/20",
  anexado: "bg-amber-100 text-amber-800 ring-amber-500/20",
  validado: "bg-green-100 text-green-800 ring-green-500/20",
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
