import React from "react";
import { trpc } from "../../lib/trpc";

type BusinessDomainCode =
  | "processo_licitatorio"
  | "contratacao_direta"
  | "contratos"
  | "parecer_juridico"
  | "gestao_departamento";

interface DomainWorkspaceLauncherProps {
  code?: BusinessDomainCode;
}

export default function DomainWorkspaceLauncher({
  code = "processo_licitatorio",
}: DomainWorkspaceLauncherProps) {
  const launch = trpc.businessDomain.launchWorkspace.useMutation();

  const workspace = launch.data?.workspace as
    | { id?: string; workspaceType?: string }
    | undefined;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">
        Abrir workspace
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        Módulo: <span className="font-mono text-gray-700">{code}</span>
      </p>

      <button
        type="button"
        disabled={launch.isPending}
        onClick={() => launch.mutate({ code })}
        className={
          "rounded-lg px-4 py-2 text-sm font-medium transition " +
          (launch.isPending
            ? "cursor-not-allowed bg-indigo-300 text-white"
            : "bg-indigo-600 text-white hover:bg-indigo-700")
        }
      >
        {launch.isPending ? "Abrindo..." : "Abrir workspace"}
      </button>

      {launch.isError ? (
        <p className="mt-3 text-sm text-red-600">
          Erro ao abrir workspace: {launch.error.message}
        </p>
      ) : null}

      {launch.data && workspace ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-medium text-green-800">
            {launch.data.existing ? "Workspace existente" : "Workspace criado"}
          </p>
          <p className="mt-1 text-green-700">
            ID:{" "}
            <span className="font-mono">{workspace.id ?? "—"}</span>
          </p>
          <p className="text-green-700">
            Tipo:{" "}
            <span className="font-mono">{workspace.workspaceType ?? "—"}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
