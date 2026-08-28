import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * ProcurementItemPanel — REAL (wired to tRPC).
 *
 * UX: painel lateral de INTELIGÊNCIA de um item. A experiência é de REVISÃO:
 * o servidor já decidiu o CATMAT e produziu recomendações; cada recomendação
 * SEMPRE mostra reasoning, explainability, provenance e confidence. A decisão de
 * CATMAT/CATSER passa pelo contrato GOVERNADO (`decidirCATMAT`: ledger imutável,
 * threshold institucional, idempotência) e a aprovação final do item é humana.
 */

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const SEVERITY_CLASSES: Record<string, string> = {
  baixo: "bg-green-100 text-green-700",
  medio: "bg-yellow-100 text-yellow-800",
  alto: "bg-orange-100 text-orange-700",
  critico: "bg-red-100 text-red-700",
};

const ITEM_STATUS_CLASSES: Record<string, string> = {
  pendente: "bg-gray-100 text-gray-700",
  em_analise: "bg-blue-100 text-blue-700",
  aprovado: "bg-green-100 text-green-700",
  rejeitado: "bg-red-100 text-red-700",
};

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-gray-100 px-5 py-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

export type ProcurementItemPanelProps = {
  itemId?: string;
  onClose?: () => void;
};

export default function ProcurementItemPanel({
  itemId = "",
  onClose,
}: ProcurementItemPanelProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.itemIntelligence.getItem.useQuery(
    { itemId },
    { enabled: !!itemId },
  );

  const invalidate = () => {
    if (itemId) utils.itemIntelligence.getItem.invalidate({ itemId });
  };

  // C — decisão CATMAT/CATSER pelo CONTRATO GOVERNADO (`itemIntelligence.decidirCATMAT`): decisão
  // humana + immutable ledger + threshold institucional + idempotência/replay + tenant isolation.
  // Cada clique é uma TENTATIVA LÓGICA nova (idempotencyKey fresco); um erro transitório pode ser
  // reenviado com a mesma chave sem duplicar (garantido pelo backend). Nunca fabrica CATMAT: o código
  // vem de uma sugestão existente ou de input humano explícito. A aprovação final do item é humana.
  const [decisionMsg, setDecisionMsg] = React.useState<string>("");
  const [thresholdBlocked, setThresholdBlocked] = React.useState<boolean>(false);
  const [manualCode, setManualCode] = React.useState<string>("");
  const [manualDesc, setManualDesc] = React.useState<string>("");
  const pendingKey = React.useRef<string>("");

  const newIdempotencyKey = () => {
    const k = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "").slice(0, 48);
    pendingKey.current = k;
    return k;
  };

  const decidirCATMAT = trpc.itemIntelligence.decidirCATMAT.useMutation({
    onSuccess: (res) => {
      pendingKey.current = "";
      setThresholdBlocked(false);
      const d = res.decision;
      setDecisionMsg(
        res.replayed
          ? "Decisão já registrada (replay idempotente)."
          : `Decisão registrada: ${d.decision}${d.catmatCode ? ` (${d.catmatCode})` : ""}.`,
      );
      invalidate();
    },
    onError: (err) => {
      const msg = err.message ?? "Falha ao registrar a decisão.";
      const isThreshold = /limiar|threshold|configurad/i.test(msg);
      setThresholdBlocked(isThreshold);
      setDecisionMsg(
        isThreshold
          ? "Limiar institucional (threshold) não configurado. Um gestor precisa configurá-lo antes de decisões seguras de CATMAT/CATSER."
          : msg,
      );
    },
  });

  const decide = (opts: {
    decision: "confirmado" | "substituido" | "rejeitado" | "sem_correspondencia_segura";
    suggestionId?: string;
    catmatCode?: string;
    catmatDescription?: string;
  }) => {
    if (!item) return;
    setDecisionMsg("");
    decidirCATMAT.mutate({
      itemId: item.id,
      decision: opts.decision,
      idempotencyKey: newIdempotencyKey(),
      suggestionId: opts.suggestionId,
      catmatCode: opts.catmatCode,
      catmatDescription: opts.catmatDescription,
    });
  };

  const approveItem = trpc.procurementProcess.approveItem.useMutation({
    onSuccess: invalidate,
  });

  const item = data?.item ?? null;

  return (
    <aside className="flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white">
      <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
        <h2 className="font-semibold text-gray-900">Inteligência do Item</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Fechar"
          >
            ✕
          </button>
        )}
      </header>

      {!itemId ? (
        <div className="p-6 text-sm text-gray-500">
          Selecione um item para ver sua inteligência.
        </div>
      ) : isLoading ? (
        <div className="animate-pulse space-y-3 p-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : !item || !data ? (
        <div className="p-6 text-sm text-gray-500">Item não encontrado.</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Cabeçalho do item */}
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-gray-900">{item.description}</p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  ITEM_STATUS_CLASSES[item.status] ??
                  "bg-gray-100 text-gray-700"
                }`}
              >
                {item.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {item.quantity} {item.unit} · média {brl(item.averagePrice)}
            </p>
          </div>

          {/* 1. Pesquisa / fornecedores */}
          <Block title="Pesquisa de preços (fornecedores)">
            {item.suppliers.length === 0 ? (
              <p className="text-sm text-gray-400">Sem cotações.</p>
            ) : (
              <ul className="space-y-1">
                {item.suppliers.map((s, i) => (
                  <li
                    key={`${s.name}-${i}`}
                    className="flex justify-between text-sm text-gray-700"
                  >
                    <span>{s.name}</span>
                    <span className="font-mono">{brl(s.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {/* 2. Histórico */}
          <Block title="Histórico de contratações">
            {data.history.length === 0 ? (
              <p className="text-sm text-gray-400">Sem histórico.</p>
            ) : (
              <ul className="space-y-2">
                {data.history.map((h) => (
                  <li key={h.id} className="rounded-md bg-gray-50 p-2 text-xs">
                    <p className="font-medium text-gray-800">
                      {h.object} ({h.year})
                    </p>
                    <p className="text-gray-500">
                      {h.winningSupplier} · {brl(h.homologatedPrice)} · CATMAT{" "}
                      {h.catmatUsed} · {h.outcome}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {/* 3. CATMAT sugerido + alternativas (servidor decide) */}
          <Block title="CATMAT (decisão do servidor)">
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs text-indigo-600">Sugerido</p>
              <p className="font-mono text-sm font-semibold text-indigo-900">
                {item.suggestedCATMAT ?? "—"}
              </p>
            </div>
            {item.alternativeCATMAT.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 text-xs text-gray-500">Alternativas</p>
                <div className="flex flex-wrap gap-1">
                  {item.alternativeCATMAT.map((c) => (
                    <span
                      key={c}
                      className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Candidatos CATMAT com score/rank/decisão */}
            {data.catmat.length > 0 && (
              <ul className="mt-3 space-y-2">
                {data.catmat.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-md border border-gray-100 p-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-gray-800">
                        #{c.rank} {c.catmatCode}
                      </span>
                      <span className="text-gray-400">
                        score {c.score.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-gray-600">{c.catmatDescription}</p>
                    <p className="mt-0.5 text-gray-400">decisão: {c.decision}</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          decide({
                            decision: "confirmado",
                            suggestionId: c.id,
                            catmatCode: c.catmatCode,
                            catmatDescription: c.catmatDescription,
                          })
                        }
                        disabled={decidirCATMAT.isPending}
                        className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => decide({ decision: "rejeitado", suggestionId: c.id })}
                        disabled={decidirCATMAT.isPending}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Rejeitar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Substituição manual (decisão governada = substituido) — código explícito do servidor */}
            <div className="mt-3 rounded-md border border-gray-100 p-2">
              <p className="mb-1 text-xs font-medium text-gray-500">
                Substituir por código manual
              </p>
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Código CATMAT/CATSER"
                  className="rounded border border-gray-200 px-2 py-1 font-mono text-xs"
                />
                <input
                  type="text"
                  value={manualDesc}
                  onChange={(e) => setManualDesc(e.target.value)}
                  placeholder="Descrição (opcional)"
                  className="rounded border border-gray-200 px-2 py-1 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      decide({
                        decision: "substituido",
                        catmatCode: manualCode.trim(),
                        catmatDescription: manualDesc.trim() || undefined,
                      })
                    }
                    disabled={decidirCATMAT.isPending || manualCode.trim().length === 0}
                    className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Substituir
                  </button>
                  <button
                    type="button"
                    onClick={() => decide({ decision: "sem_correspondencia_segura" })}
                    disabled={decidirCATMAT.isPending}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Sem correspondência segura
                  </button>
                </div>
              </div>
            </div>

            {decisionMsg && (
              <p
                className={`mt-2 text-xs ${
                  thresholdBlocked ? "text-orange-700" : "text-gray-500"
                }`}
              >
                {decisionMsg}
              </p>
            )}
          </Block>

          {/* 4. Especificações */}
          <Block title="Especificações">
            {item.specifications.length === 0 ? (
              <p className="text-sm text-gray-400">Sem especificações.</p>
            ) : (
              <ul className="list-disc pl-4 text-sm text-gray-700">
                {item.specifications.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
          </Block>

          {/* 5. Alertas / riscos (com severity) */}
          <Block title="Alertas e riscos">
            {data.risks.length === 0 ? (
              <p className="text-sm text-gray-400">Sem riscos identificados.</p>
            ) : (
              <ul className="space-y-2">
                {data.risks.map((r) => (
                  <li key={r.id} className="rounded-md bg-gray-50 p-2 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-medium text-gray-700">{r.type}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          SEVERITY_CLASSES[r.severity] ??
                          "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {r.severity}
                      </span>
                    </div>
                    <p className="text-gray-600">{r.description}</p>
                    <p className="mt-0.5 italic text-gray-400">{r.explanation}</p>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {/* 6. Cláusulas (derivadas das especificações) */}
          <Block title="Cláusulas sugeridas">
            {item.specifications.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma cláusula sugerida.</p>
            ) : (
              <ul className="space-y-1 text-sm text-gray-700">
                {item.specifications.map((s, i) => (
                  <li key={i} className="rounded bg-gray-50 px-2 py-1">
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {/* 7. Justificativas / recomendações textuais do item */}
          <Block title="Justificativas">
            {item.recommendations.length === 0 ? (
              <p className="text-sm text-gray-400">Sem justificativas.</p>
            ) : (
              <ul className="list-disc pl-4 text-sm text-gray-700">
                {item.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </Block>

          {/* 8. Knowledge graph */}
          <Block title="Knowledge graph">
            <p className="text-sm text-gray-600">
              {data.graphNodeIds.length} nó(s) conectados a este item.
            </p>
          </Block>

          {/* 9. Recomendações (reasoning + explainability + provenance + confidence) */}
          <Block title="Recomendações do sistema">
            {data.recommendations.length === 0 ? (
              <p className="text-sm text-gray-400">Sem recomendações.</p>
            ) : (
              <ul className="space-y-3">
                {data.recommendations.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-gray-200 p-3 text-xs"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-medium text-gray-800">
                        {r.type}
                      </span>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                        confiança {Math.round(r.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-gray-800">{r.summary}</p>
                    <p className="mt-1 text-gray-500">
                      <strong>Reasoning:</strong> {r.reasoning}
                    </p>
                    <p className="mt-0.5 text-gray-500">
                      <strong>Explainability:</strong> {r.explainability}
                    </p>
                    <p className="mt-0.5 text-gray-400">
                      <strong>Proveniência:</strong> {r.provenance}
                    </p>
                    {r.accepted !== null && (
                      <p className="mt-1 text-gray-400">
                        {r.accepted ? "Aceita" : "Rejeitada"}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {/* Ação final: aprovar item */}
          <div className="px-5 py-4">
            <button
              type="button"
              onClick={() => approveItem.mutate({ itemId: item.id })}
              disabled={approveItem.isPending}
              className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {approveItem.isPending ? "Aprovando..." : "Aprovar item"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
