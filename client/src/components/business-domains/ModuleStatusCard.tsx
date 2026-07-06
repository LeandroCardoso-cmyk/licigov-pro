import React from "react";
import { trpc } from "../../lib/trpc";

type BusinessDomainCode =
  | "processo_licitatorio"
  | "contratacao_direta"
  | "contratos"
  | "parecer_juridico"
  | "gestao_departamento";

interface ModuleStatusCardProps {
  code?: BusinessDomainCode;
}

export default function ModuleStatusCard({
  code = "processo_licitatorio",
}: ModuleStatusCardProps) {
  const { data, isLoading } = trpc.businessDomain.getDomainStatus.useQuery({
    code,
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Status do módulo
      </h2>
      <p className="mb-4 font-mono text-sm text-gray-700">{code}</p>

      {isLoading ? (
        <div className="space-y-2">
          <div className="h-6 w-32 animate-pulse rounded bg-gray-100" />
          <div className="h-6 w-40 animate-pulse rounded bg-gray-100" />
        </div>
      ) : !data ? (
        <p className="text-sm text-gray-500">Status indisponível.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Licença</span>
            <span
              className={
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " +
                (data.licensed
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-600")
              }
            >
              {data.licensed ? "Licenciado" : "Não licenciado"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Workspace</span>
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <span
                className={
                  "h-2.5 w-2.5 rounded-full " +
                  (data.hasWorkspace ? "bg-green-500" : "bg-gray-300")
                }
              />
              {data.hasWorkspace ? "Criado" : "Não criado"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
