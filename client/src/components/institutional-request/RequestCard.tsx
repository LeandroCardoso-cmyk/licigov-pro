import React from "react";

/**
 * RequestCard — PRESENTATIONAL.
 *
 * Cartão de uma solicitação institucional. Nenhum domínio conversa diretamente
 * com outro: toda troca flui pelo Institutional Request Engine. Este cartão
 * apenas exibe o trânsito origem → destino de uma solicitação.
 */

export type BusinessDomain =
  | "processo_licitatorio"
  | "contratacao_direta"
  | "contratos"
  | "parecer_juridico"
  | "gestao_departamento"
  | "controle_interno";

export type RequestStatus =
  | "NEW"
  | "PENDING"
  | "RECEIVED"
  | "IN_PROGRESS"
  | "WAITING_INFORMATION"
  | "COMPLETED"
  | "RETURNED"
  | "ARCHIVED";

export type RequestPriority = "baixa" | "media" | "alta" | "urgente";

export interface RequestCardData {
  id: string;
  title: string;
  sourceDomain: string;
  destinationDomain: string;
  requestType: string;
  priority: string;
  status: string;
  createdAt: string;
}

export interface RequestCardProps {
  request?: RequestCardData;
  onClick?: (id: string) => void;
}

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

export const STATUS_LABELS: Record<string, string> = {
  NEW: "Nova",
  PENDING: "Pendente",
  RECEIVED: "Recebida",
  IN_PROGRESS: "Em Andamento",
  WAITING_INFORMATION: "Aguardando Informação",
  COMPLETED: "Concluída",
  RETURNED: "Devolvida",
  ARCHIVED: "Arquivada",
};

export const STATUS_CLASSES: Record<string, string> = {
  NEW: "bg-gray-100 text-gray-700 ring-gray-500/20",
  PENDING: "bg-amber-100 text-amber-800 ring-amber-500/20",
  RECEIVED: "bg-blue-100 text-blue-800 ring-blue-500/20",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800 ring-indigo-500/20",
  WAITING_INFORMATION: "bg-yellow-100 text-yellow-800 ring-yellow-500/20",
  COMPLETED: "bg-green-100 text-green-800 ring-green-500/20",
  RETURNED: "bg-teal-100 text-teal-800 ring-teal-500/20",
  ARCHIVED: "bg-gray-100 text-gray-500 ring-gray-500/20",
};

export const PRIORITY_LABELS: Record<string, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

export const PRIORITY_CLASSES: Record<string, string> = {
  baixa: "bg-green-100 text-green-800 ring-green-500/20",
  media: "bg-blue-100 text-blue-800 ring-blue-500/20",
  alta: "bg-orange-100 text-orange-800 ring-orange-500/20",
  urgente: "bg-red-100 text-red-800 ring-red-500/20",
};

export function domainLabel(code: string): string {
  return DOMAIN_LABELS[code] ?? code;
}

export function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const MOCK_REQUEST: RequestCardData = {
  id: "req-0001",
  title: "Parecer inicial sobre minuta de edital — Pregão 014/2026",
  sourceDomain: "processo_licitatorio",
  destinationDomain: "parecer_juridico",
  requestType: "LEGAL_OPINION_INITIAL",
  priority: "alta",
  status: "PENDING",
  createdAt: new Date().toISOString(),
};

export default function RequestCard({ request = MOCK_REQUEST, onClick }: RequestCardProps) {
  const statusClass = STATUS_CLASSES[request.status] ?? STATUS_CLASSES.NEW;
  const priorityClass = PRIORITY_CLASSES[request.priority] ?? PRIORITY_CLASSES.media;

  return (
    <button
      type="button"
      onClick={() => onClick?.(request.id)}
      className="group w-full rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 group-hover:text-indigo-700">
          {request.title}
        </h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${priorityClass}`}>
          {PRIORITY_LABELS[request.priority] ?? request.priority}
        </span>
      </div>

      {/* Trânsito institucional: origem → destino (nunca conversa direta) */}
      <div className="mb-3 flex items-center gap-1 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{domainLabel(request.sourceDomain)}</span>
        <span aria-hidden className="text-gray-400">→</span>
        <span className="font-medium text-gray-700">{domainLabel(request.destinationDomain)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {REQUEST_TYPE_LABELS[request.requestType] ?? request.requestType}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClass}`}>
          {STATUS_LABELS[request.status] ?? request.status}
        </span>
        <span className="ml-auto text-xs text-gray-400">{formatDate(request.createdAt)}</span>
      </div>
    </button>
  );
}
