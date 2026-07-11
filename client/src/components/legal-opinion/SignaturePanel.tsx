import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * SignaturePanel — REAL (tRPC).
 *
 * Assinatura do parecer. Apenas MANUAL está implementada nesta fase; ICP-Brasil,
 * GOV.BR e Certificado A1 são placeholders (arquitetura preparada, não ativos).
 * Após assinar, o parecer pode ser devolvido automaticamente à origem.
 */

export interface SignaturePanelProps {
  workspaceId?: string;
  signed?: boolean;
  onSigned?: (workspaceId: string) => void;
  onReturned?: (workspaceId: string) => void;
}

const METHODS: Array<{ value: "manual" | "icp_brasil" | "gov_br" | "certificado_a1"; label: string; implemented: boolean }> = [
  { value: "manual", label: "Manual", implemented: true },
  { value: "icp_brasil", label: "ICP-Brasil", implemented: false },
  { value: "gov_br", label: "GOV.BR", implemented: false },
  { value: "certificado_a1", label: "Certificado A1", implemented: false },
];

export default function SignaturePanel({ workspaceId = "", signed = false, onSigned, onReturned }: SignaturePanelProps) {
  const enabled = workspaceId.trim().length > 0;
  const utils = trpc.useUtils();
  const [method, setMethod] = React.useState<"manual" | "icp_brasil" | "gov_br" | "certificado_a1">("manual");

  const sign = trpc.legalOpinionWorkspace.signOpinion.useMutation({
    onSuccess: () => {
      void utils.legalOpinionWorkspace.loadContext.invalidate({ workspaceId });
      onSigned?.(workspaceId);
    },
  });
  const ret = trpc.legalOpinionWorkspace.returnOpinion.useMutation({
    onSuccess: () => {
      void utils.legalOpinionWorkspace.listInbox.invalidate();
      void utils.legalOpinionWorkspace.loadContext.invalidate({ workspaceId });
      onReturned?.(workspaceId);
    },
  });

  if (!enabled) {
    return <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-400">Selecione um parecer para assinar.</div>;
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Assinatura</h3>
        <p className="text-xs text-gray-500">Apenas assinatura manual nesta fase. Demais métodos: em preparação.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {METHODS.map((m) => (
          <button
            key={m.value}
            type="button"
            disabled={!m.implemented}
            onClick={() => setMethod(m.value)}
            className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
              method === m.value ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-gray-200 text-gray-600"
            } ${!m.implemented ? "cursor-not-allowed opacity-50" : "hover:border-indigo-300"}`}
          >
            {m.label}{!m.implemented ? " (em breve)" : ""}
          </button>
        ))}
      </div>

      {sign.isError && <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{sign.error.message}</p>}
      {ret.isError && <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{ret.error.message}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={sign.isPending || signed}
          onClick={() => sign.mutate({ workspaceId, method })}
          className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {signed ? "Parecer assinado" : sign.isPending ? "Assinando…" : "Assinar parecer"}
        </button>
        <button
          type="button"
          disabled={ret.isPending || !signed}
          onClick={() => ret.mutate({ workspaceId })}
          className="flex-1 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
        >
          {ret.isPending ? "Devolvendo…" : "Devolver à origem"}
        </button>
      </div>
      <p className="text-[11px] text-gray-400">A devolução retorna o parecer automaticamente ao domínio solicitante via Institutional Request Engine.</p>
    </div>
  );
}
