import React from "react";

export interface CopilotSession {
  id: string;
  copilotType: string;
  query: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

const STATUS_BADGE: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  reasoning: "bg-blue-100 text-blue-700",
  recommended: "bg-indigo-100 text-indigo-700",
  awaiting_approval: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  closed: "bg-gray-100 text-gray-700",
};

const COPILOT_LABEL: Record<string, string> = {
  agente_contratacao: "Agente de Contratação",
  pregoeiro: "Pregoeiro",
  planejamento: "Planejamento",
  tr_intelligence: "TR Intelligence",
  juridico: "Jurídico",
  pesquisa_precos: "Pesquisa de Preços",
  contratos: "Contratos",
  controle_interno: "Controle Interno",
};

const DEFAULT_SESSION: CopilotSession = {
  id: "sess_demo",
  copilotType: "agente_contratacao",
  query: "Analisar a viabilidade de contratação direta por dispensa de licitação.",
  status: "recommended",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function fmt(date?: string): string {
  if (!date) return "—";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleString("pt-BR");
}

interface CopilotSessionViewerProps {
  session?: CopilotSession;
}

export default function CopilotSessionViewer({ session = DEFAULT_SESSION }: CopilotSessionViewerProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400">Copiloto</p>
          <p className="text-sm font-semibold text-gray-900">
            {COPILOT_LABEL[session.copilotType] ?? session.copilotType}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            STATUS_BADGE[session.status] ?? "bg-gray-100 text-gray-700"
          }`}
        >
          {session.status}
        </span>
      </div>

      <div className="mb-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">Consulta</p>
        <p className="mt-1 text-sm text-gray-800">{session.query}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400">Criada em</p>
          <p className="mt-1 text-sm text-gray-700">{fmt(session.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400">Atualizada em</p>
          <p className="mt-1 text-sm text-gray-700">{fmt(session.updatedAt)}</p>
        </div>
      </div>

      <p className="mt-4 font-mono text-xs text-gray-400">ID: {session.id}</p>
    </div>
  );
}
