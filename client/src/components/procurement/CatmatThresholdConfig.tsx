import React from "react";
import { trpc } from "../../lib/trpc";
import { useOrgRole } from "../../_core/hooks/useOrgRole";
import { parseThresholdInput, thresholdImpactLines, canSubmitThresholdChange, type CatmatThresholdPreviewUI, type CatmatThresholdInput } from "./catmatThresholdPolicy";

/**
 * CatmatThresholdConfig — REAL (tRPC).
 *
 * Superfície institucional MÍNIMA para consultar e configurar o LIMIAR (threshold) de
 * CATMAT/CATSER do tenant. O limiar é fail-closed: enquanto não configurado, as decisões
 * governadas de CATMAT (`itemIntelligence.decidirCATMAT`) são recusadas (412). O sistema
 * NUNCA escolhe este número — ele é fornecido aqui por um responsável autorizado.
 *
 * Governança:
 *  - LEITURA: qualquer papel do tenant vê o valor vigente / o estado "não configurado".
 *  - ESCRITA: apenas `manager+` (o backend `setCATMATThreshold` é `orgRoleProcedure("manager")`).
 *    O frontend apenas gateia a EXPERIÊNCIA; a autorização real é do backend (fail-closed).
 *  - Não cria default silencioso: o valor só existe após uma decisão humana explícita aqui.
 */
export default function CatmatThresholdConfig() {
  const utils = trpc.useUtils();
  const { hasRole, isLoading: roleLoading } = useOrgRole();
  const canEdit = hasRole("manager");

  const thresholdQuery = trpc.itemIntelligence.getCATMATThreshold.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const [minScorePct, setMinScorePct] = React.useState<string>("");
  const [reason, setReason] = React.useState<string>("");
  const [okMsg, setOkMsg] = React.useState<string>("");
  const [validationMsg, setValidationMsg] = React.useState<string>("");
  // SEM-061 — a troca passa por uma PRÉVIA do impacto org-wide + confirmação explícita; o 1º clique não grava nada.
  const [pending, setPending] = React.useState<{ input: CatmatThresholdInput; preview: CatmatThresholdPreviewUI } | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState("");

  const setThreshold = trpc.itemIntelligence.setCATMATThreshold.useMutation({
    onSuccess: (res) => {
      setOkMsg(
        res.configured
          ? `Limiar institucional configurado: ${Math.round((res.minScore ?? 0) * 100)}% (versão ${res.version}).`
          : "Limiar registrado.",
      );
      setReason("");
      setPending(null);
      void utils.itemIntelligence.getCATMATThreshold.invalidate();
    },
    onError: () => setOkMsg(""),
  });

  const configured = thresholdQuery.data?.configured === true;
  const currentPct = configured ? Math.round((thresholdQuery.data!.minScore ?? 0) * 100) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOkMsg("");
    setValidationMsg("");
    setPreviewError("");
    const parsed = parseThresholdInput(minScorePct, reason);
    if (!parsed.ok) {
      setValidationMsg(parsed.error);
      return;
    }
    setPreviewing(true);
    try {
      const preview = await utils.itemIntelligence.previewCATMATThresholdChange.fetch({ minScore: parsed.value.minScore });
      setPending({ input: parsed.value, preview: preview as CatmatThresholdPreviewUI });
    } catch (err) {
      setPending(null);
      setPreviewError(err instanceof Error ? err.message : "Não foi possível calcular o impacto da mudança.");
    } finally {
      setPreviewing(false);
    }
  };
  const confirmChange = () => {
    if (!pending || !canSubmitThresholdChange({ previewShownFor: pending.preview.proposedMinScore, proposed: pending.input.minScore, confirmed: true, pending: setThreshold.isPending })) return;
    setThreshold.mutate(pending.input);
  };

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Limiar institucional de CATMAT/CATSER</h2>
        {thresholdQuery.isLoading ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Carregando…</span>
        ) : configured ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
            Configurado: {currentPct}% (v{thresholdQuery.data!.version})
          </span>
        ) : (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300">
            Não configurado
          </span>
        )}
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Score mínimo (0–100%) para que uma sugestão de CATMAT/CATSER seja considerada segura nas decisões
        governadas. Enquanto não configurado, as decisões de CATMAT permanecem bloqueadas (fail-closed).
      </p>

      {!canEdit ? (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {roleLoading
            ? "Verificando permissões…"
            : "Apenas um gestor (papel mínimo manager) pode configurar o limiar institucional. Solicite a um responsável autorizado."}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
            <label className="block text-xs font-medium text-foreground">
              Score mínimo (%)
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={minScorePct}
                onChange={(e) => setMinScorePct(e.target.value)}
                placeholder={currentPct !== null ? String(currentPct) : "ex.: 70"}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none"
              />
            </label>
            <label className="block text-xs font-medium text-foreground">
              Justificativa institucional
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Fundamente a escolha do limiar (mín. 3 caracteres)"
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={setThreshold.isPending || previewing || pending !== null}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
            >
              {previewing ? "Calculando impacto…" : configured ? "Revisar impacto e atualizar limiar" : "Revisar impacto e configurar limiar"}
            </button>
            {okMsg && <span className="text-xs text-green-700 dark:text-green-300">{okMsg}</span>}
            {previewError && <span className="text-xs text-red-600 dark:text-red-300">{previewError}</span>}
            {validationMsg && <span className="text-xs text-orange-700 dark:text-orange-300">{validationMsg}</span>}
            {setThreshold.isError && (
              <span className="text-xs text-red-600 dark:text-red-300">{setThreshold.error.message}</span>
            )}
          </div>
          {pending && (
            <div role="alertdialog" aria-label="Confirmar alteração do limiar" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-medium">Confirme o impacto antes de alterar o limiar</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {thresholdImpactLines(pending.preview).map((l) => <li key={l}>{l}</li>)}
              </ul>
              <div className="flex gap-2">
                <button type="button" onClick={confirmChange} disabled={setThreshold.isPending}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
                  {setThreshold.isPending ? "Salvando…" : "Confirmar alteração do limiar"}
                </button>
                <button type="button" onClick={() => setPending(null)} disabled={setThreshold.isPending}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Cancelar</button>
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            A versão anterior é preservada (inativa) — a mudança é auditável. Após configurar, as decisões
            governadas de CATMAT/CATSER voltam a funcionar normalmente.
          </p>
        </form>
      )}
    </section>
  );
}
