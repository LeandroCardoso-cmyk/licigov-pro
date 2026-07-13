/**
 * FASE 5 — Contratos: rótulos e estilos compartilhados (pt-BR).
 */

export const ORIGIN_LABELS: Record<string, string> = {
  processo_licitatorio: "Processo Licitatório",
  contratacao_direta: "Contratação Direta",
  externo: "Contrato Externo",
};

export const STATUS_LABELS: Record<string, string> = {
  minuta: "Minuta",
  vigente: "Vigente",
  aditado: "Aditado",
  apostilado: "Apostilado",
  encerrado: "Encerrado",
  rescindido: "Rescindido",
  arquivado: "Arquivado",
};

export const STATUS_CLASSES: Record<string, string> = {
  minuta: "bg-amber-100 text-amber-800 ring-amber-500/20",
  vigente: "bg-green-100 text-green-800 ring-green-500/20",
  aditado: "bg-blue-100 text-blue-800 ring-blue-500/20",
  apostilado: "bg-indigo-100 text-indigo-800 ring-indigo-500/20",
  encerrado: "bg-gray-100 text-gray-600 ring-gray-500/20",
  rescindido: "bg-red-100 text-red-700 ring-red-500/20",
  arquivado: "bg-gray-100 text-gray-500 ring-gray-500/20",
};

export const DOC_KIND_LABELS: Record<string, string> = {
  contrato: "Contrato", aditivo: "Termo Aditivo", apostilamento: "Apostilamento", rescisao: "Rescisão", anexo: "Anexo",
};

export const ADDENDUM_TYPE_LABELS: Record<string, string> = {
  prazo: "Prazo", valor: "Valor", quantitativo: "Quantitativo", qualitativo: "Qualitativo",
};

export const APOSTILLE_KIND_LABELS: Record<string, string> = {
  reajuste: "Reajuste", gestor: "Alteração de Gestor", fiscal: "Alteração de Fiscal", legal: "Alteração Legal",
};

export function originLabel(code: string): string { return ORIGIN_LABELS[code] ?? code; }
export function statusLabel(code: string): string { return STATUS_LABELS[code] ?? code; }

export function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
