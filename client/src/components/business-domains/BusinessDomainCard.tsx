import React from "react";

export interface BusinessDomainCardDomain {
  code: string;
  name: string;
  workspaceType: string;
  licensed: boolean;
  active: boolean;
}

interface BusinessDomainCardProps {
  domain?: BusinessDomainCardDomain;
  onLaunch?: (code: string) => void;
}

const DEFAULT_DOMAIN: BusinessDomainCardDomain = {
  code: "processo_licitatorio",
  name: "Processo Licitatório",
  workspaceType: "licitacao",
  licensed: true,
  active: true,
};

export default function BusinessDomainCard({
  domain = DEFAULT_DOMAIN,
  onLaunch = () => {},
}: BusinessDomainCardProps) {
  const enabled = domain.licensed && domain.active;

  return (
    <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div>
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900">{domain.name}</h3>
          <span
            className={
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " +
              (domain.licensed
                ? "bg-green-100 text-green-800"
                : "bg-gray-100 text-gray-600")
            }
          >
            {domain.licensed ? "Licenciado" : "Não licenciado"}
          </span>
        </div>
        <p className="mb-4 text-xs uppercase tracking-wide text-gray-400">
          {domain.workspaceType}
        </p>
      </div>

      <button
        type="button"
        disabled={!enabled}
        onClick={() => onLaunch(domain.code)}
        className={
          "mt-2 w-full rounded-lg px-4 py-2 text-sm font-medium transition " +
          (enabled
            ? "bg-indigo-600 text-white hover:bg-indigo-700"
            : "cursor-not-allowed bg-gray-100 text-gray-400")
        }
      >
        Abrir módulo
      </button>
    </div>
  );
}
