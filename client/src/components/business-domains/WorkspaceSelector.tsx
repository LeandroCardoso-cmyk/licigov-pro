import React from "react";

export interface WorkspaceSelectorDomain {
  code: string;
  name: string;
  licensed: boolean;
}

interface WorkspaceSelectorProps {
  domains?: WorkspaceSelectorDomain[];
  onSelect?: (code: string) => void;
}

const DEFAULT_DOMAINS: WorkspaceSelectorDomain[] = [
  { code: "processo_licitatorio", name: "Processo Licitatório", licensed: true },
  { code: "contratacao_direta", name: "Contratação Direta", licensed: false },
  { code: "contratos", name: "Contratos e Aditivos", licensed: true },
  { code: "parecer_juridico", name: "Parecer Jurídico", licensed: false },
  { code: "gestao_departamento", name: "Gestão do Departamento", licensed: true },
];

export default function WorkspaceSelector({
  domains = DEFAULT_DOMAINS,
  onSelect = () => {},
}: WorkspaceSelectorProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-gray-900">
        Selecionar workspace
      </p>
      <ul className="space-y-1">
        {domains.map((d) => (
          <li key={d.code}>
            <button
              type="button"
              disabled={!d.licensed}
              onClick={() => onSelect(d.code)}
              className={
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition " +
                (d.licensed
                  ? "text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
                  : "cursor-not-allowed text-gray-400")
              }
            >
              <span>{d.name}</span>
              <span
                className={
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium " +
                  (d.licensed
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-500")
                }
              >
                {d.licensed ? "Licenciado" : "Não licenciado"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
