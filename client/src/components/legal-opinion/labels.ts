/**
 * FASE 5 — Parecer Jurídico: rótulos e estilos compartilhados (pt-BR).
 * Presentational helpers reutilizados pelos componentes do domínio.
 */

export const DOMAIN_LABELS: Record<string, string> = {
  processo_licitatorio: "Processo Licitatório",
  contratacao_direta: "Contratação Direta",
  contratos: "Contratos",
  parecer_juridico: "Parecer Jurídico",
  gestao_departamento: "Gestão do Departamento",
  controle_interno: "Controle Interno",
};

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  LEGAL_OPINION_INITIAL: "Parecer Inicial",
  LEGAL_OPINION_FINAL: "Parecer Final",
  CONTROL_REVIEW: "Revisão de Controle",
  TECHNICAL_REVIEW: "Revisão Técnica",
  DOCUMENT_REVIEW: "Revisão Documental",
  APPROVAL: "Aprovação",
  SIGNATURE: "Assinatura",
  INFORMATION_REQUEST: "Pedido de Informação",
  CORRECTION_REQUEST: "Pedido de Correção",
};

export const STAGE_LABELS: Record<string, string> = {
  INBOX: "Na Caixa",
  RECEIVED: "Recebido",
  UNDER_ANALYSIS: "Em Análise",
  WAITING_INFORMATION: "Aguardando Informação",
  DRAFT: "Em Elaboração",
  REVIEW: "Em Revisão",
  SIGNED: "Assinado",
  RETURNED: "Devolvido",
  ARCHIVED: "Arquivado",
};

export const STAGE_CLASSES: Record<string, string> = {
  INBOX: "bg-gray-100 text-gray-700 ring-gray-500/20",
  RECEIVED: "bg-blue-100 text-blue-800 ring-blue-500/20",
  UNDER_ANALYSIS: "bg-indigo-100 text-indigo-800 ring-indigo-500/20",
  WAITING_INFORMATION: "bg-yellow-100 text-yellow-800 ring-yellow-500/20",
  DRAFT: "bg-amber-100 text-amber-800 ring-amber-500/20",
  REVIEW: "bg-purple-100 text-purple-800 ring-purple-500/20",
  SIGNED: "bg-green-100 text-green-800 ring-green-500/20",
  RETURNED: "bg-teal-100 text-teal-800 ring-teal-500/20",
  ARCHIVED: "bg-gray-100 text-gray-500 ring-gray-500/20",
};

export const PRIORITY_LABELS: Record<string, string> = {
  baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente",
};

export const PRIORITY_CLASSES: Record<string, string> = {
  baixa: "bg-green-100 text-green-800 ring-green-500/20",
  media: "bg-blue-100 text-blue-800 ring-blue-500/20",
  alta: "bg-orange-100 text-orange-800 ring-orange-500/20",
  urgente: "bg-red-100 text-red-800 ring-red-500/20",
};

export const CONCLUSION_LABELS: Record<string, string> = {
  favoravel: "Favorável",
  desfavoravel: "Desfavorável",
  com_ressalvas: "Com Ressalvas",
  parcialmente_favoravel: "Parcialmente Favorável",
};

export function domainLabel(code: string): string {
  return DOMAIN_LABELS[code] ?? code;
}

export function stageLabel(code: string): string {
  return STAGE_LABELS[code] ?? code;
}

export function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
