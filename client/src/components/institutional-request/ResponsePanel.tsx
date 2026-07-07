import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * ResponsePanel — REAL (tRPC).
 *
 * Painel de emissão de resposta institucional. Ao responder, a solicitação é
 * concluída e DEVOLVIDA AUTOMATICAMENTE ao domínio de origem pelo Request
 * Engine. A assinatura é apenas um placeholder — a assinatura real (manual,
 * ICP-Brasil, gov.br, certificado A1) ainda NÃO está implementada.
 */

export interface ResponsePanelProps {
  requestId?: string;
  onResponded?: (requestId: string) => void;
}

const RESPONSE_TYPES: Array<{ value: string; label: string }> = [
  { value: "parecer", label: "Parecer" },
  { value: "revisao", label: "Revisão" },
  { value: "aprovacao", label: "Aprovação" },
  { value: "informacao", label: "Informação" },
  { value: "correcao", label: "Correção" },
  { value: "assinatura", label: "Assinatura" },
];

const RESPONSE_STATUSES: Array<{ value: string; label: string }> = [
  { value: "favoravel", label: "Favorável" },
  { value: "desfavoravel", label: "Desfavorável" },
  { value: "com_ressalvas", label: "Com Ressalvas" },
  { value: "informativo", label: "Informativo" },
  { value: "concluido", label: "Concluído" },
];

const SIGNATURE_METHODS: Array<{ value: string; label: string }> = [
  { value: "", label: "Sem assinatura" },
  { value: "manual", label: "Manual (placeholder)" },
  { value: "icp_brasil", label: "ICP-Brasil (placeholder)" },
  { value: "gov_br", label: "gov.br (placeholder)" },
  { value: "certificado_a1", label: "Certificado A1 (placeholder)" },
];

export default function ResponsePanel({ requestId = "", onResponded }: ResponsePanelProps) {
  const enabled = requestId.trim().length > 0;
  const utils = trpc.useUtils();

  const [responseType, setResponseType] = React.useState("parecer");
  const [responseStatus, setResponseStatus] = React.useState("favoravel");
  const [comments, setComments] = React.useState("");
  const [sign, setSign] = React.useState("");

  const respond = trpc.institutionalRequest.respond.useMutation({
    onSuccess: () => {
      void utils.institutionalRequest.getTimeline.invalidate({ requestId });
      void utils.institutionalRequest.listPending.invalidate();
      void utils.institutionalRequest.listCompleted.invalidate();
      setComments("");
      setSign("");
      onResponded?.(requestId);
    },
  });

  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
        Selecione uma solicitação para responder.
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    respond.mutate({
      requestId,
      responseType: responseType as "parecer" | "revisao" | "aprovacao" | "informacao" | "correcao" | "assinatura",
      responseStatus: responseStatus as "favoravel" | "desfavoravel" | "com_ressalvas" | "informativo" | "concluido",
      comments: comments.trim() || undefined,
      sign: sign ? (sign as "manual" | "icp_brasil" | "gov_br" | "certificado_a1") : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Emitir resposta</h3>
        <p className="text-xs text-gray-500">
          A resposta conclui a solicitação e retorna automaticamente à origem.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-gray-700">
          Tipo de resposta
          <select
            value={responseType}
            onChange={(e) => setResponseType(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            {RESPONSE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-gray-700">
          Conclusão
          <select
            value={responseStatus}
            onChange={(e) => setResponseStatus(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            {RESPONSE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-xs font-medium text-gray-700">
        Comentários
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={4}
          placeholder="Fundamentação da resposta institucional…"
          className="mt-1 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </label>

      <label className="block text-xs font-medium text-gray-700">
        Assinatura (placeholder — não implementada)
        <select
          value={sign}
          onChange={(e) => setSign(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          {SIGNATURE_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      {respond.isError && (
        <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {respond.error.message}
        </p>
      )}
      {respond.isSuccess && (
        <p className="rounded-md border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700">
          Resposta emitida e devolvida automaticamente à origem.
        </p>
      )}

      <button
        type="submit"
        disabled={respond.isPending}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {respond.isPending ? "Enviando…" : "Emitir resposta e devolver à origem"}
      </button>
    </form>
  );
}
