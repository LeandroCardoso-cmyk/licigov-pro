import React from "react";

interface KernelStatusPanelProps {
  services?: string[];
}

const DEFAULT_SERVICES: string[] = [
  "ai_orchestration",
  "workflow_engine",
  "institutional_rag",
  "procurement_knowledge_graph",
  "document_generation",
  "audit_trail",
  "notification_service",
  "storage_service",
  "authentication",
  "authorization",
  "template_engine",
];

export default function KernelStatusPanel({
  services = DEFAULT_SERVICES,
}: KernelStatusPanelProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Kernel Cognitivo
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Serviços compartilhados. Nenhum pertence a um módulo comercial.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => (
          <div
            key={s}
            className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
          >
            <span className="truncate font-mono text-xs text-gray-700">
              {s}
            </span>
            <span className="inline-flex flex-shrink-0 items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
              Compartilhado
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-gray-400">
        {services.length} serviço(s) de kernel disponíveis para todos os módulos.
      </p>
    </div>
  );
}
