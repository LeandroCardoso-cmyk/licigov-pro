import React from "react";
import { trpc } from "../../lib/trpc";

type StatusKey =
  | "draft"
  | "active"
  | "in_review"
  | "awaiting_approval"
  | "completed"
  | "archived";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-blue-100 text-blue-700",
  in_review: "bg-amber-100 text-amber-700",
  awaiting_approval: "bg-orange-100 text-orange-700",
  completed: "bg-green-100 text-green-700",
  archived: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  in_review: "Em Revisão",
  awaiting_approval: "Aguardando Aprovação",
  completed: "Concluído",
  archived: "Arquivado",
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-gray-100 text-gray-700";
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

export default function WorkspaceHome() {
  const { data, isLoading, isError } = trpc.workspace.listWorkspaces.useQuery({
    limit: 24,
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          Espaços de Trabalho Cognitivos
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Ambientes de contratação pública assistidos por copilotos.
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-gray-200 bg-white p-5"
            >
              <div className="mb-3 h-4 w-3/4 rounded bg-gray-200" />
              <div className="mb-2 h-3 w-1/2 rounded bg-gray-200" />
              <div className="h-5 w-24 rounded-full bg-gray-200" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Não foi possível carregar os espaços de trabalho.
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {data && data.workspaces.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.workspaces.map((ws) => (
                <div
                  key={ws.id}
                  className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-sm"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold text-gray-900 line-clamp-2">
                      {ws.title}
                    </h2>
                    <StatusBadge status={ws.status} />
                  </div>
                  <dl className="mt-auto space-y-1 text-xs text-gray-500">
                    <div className="flex justify-between">
                      <dt>Tipo</dt>
                      <dd className="font-medium text-gray-700">
                        {ws.workspaceType}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Etapa</dt>
                      <dd className="font-medium text-gray-700">
                        {ws.currentStage}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Atualizado</dt>
                      <dd className="font-medium text-gray-700">
                        {new Date(ws.updatedAt).toLocaleDateString("pt-BR")}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">
              Nenhum espaço de trabalho encontrado.
            </div>
          )}
        </>
      )}
    </div>
  );
}
