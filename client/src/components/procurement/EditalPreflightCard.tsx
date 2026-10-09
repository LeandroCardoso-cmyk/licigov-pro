import type { PreflightView } from "@/lib/editalPreparation";
import { SOURCE_TITLE } from "@/lib/editalPreparation";

export interface EditalPreflightCardProps {
  preflight: PreflightView | undefined;
  loading?: boolean;
  hasTrPin: boolean;
  onRecheck: () => void;
}

/** Resultado do preflight (somente leitura no servidor: não grava rascunho/M1, não reserva geração, não chama IA). */
export default function EditalPreflightCard({ preflight, loading = false, hasTrPin, onRecheck }: EditalPreflightCardProps) {
  if (preflight?.status === "NOT_APPLICABLE") return null;
  return (
    <div className="space-y-2 rounded-lg border border-border px-4 py-3 text-sm" aria-label="Preflight do Edital institucional">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground">Verificação das fontes (preflight)</p>
        <button type="button" onClick={onRecheck} disabled={loading} className="rounded-lg border border-input px-3 py-1 text-xs">{loading ? "Verificando…" : "Verificar novamente"}</button>
      </div>
      {!hasTrPin && <p className="text-xs text-amber-600 dark:text-amber-400">Confirme o TR oficial exato para verificar a composição.</p>}
      {preflight?.status === "READY_FOR_COMPOSITION" && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">Fontes prontas para a composição. O rascunho continuará exigindo revisão humana.</p>}
      {preflight?.status === "BLOCKED" && (
        <div role="alert" className="space-y-1">
          <p className="text-xs text-destructive">
            {(preflight.pendingDecisions ?? 0) > 0
              ? `Pendente: ${preflight.pendingDecisions} ${preflight.pendingDecisions === 1 ? "decisão humana" : "decisões humanas"}.`
              : "Composição bloqueada: há pendências nas fontes do Edital."}
          </p>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Ver detalhes técnicos ({preflight.issues.length})</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-destructive">
              {preflight.issues.map((i, n) => (
                <li key={`${i.code}-${i.path ?? ""}-${n}`}>
                  {i.source ? <strong>{SOURCE_TITLE[i.source] ?? i.source}: </strong> : null}{i.message}
                  {i.path ? <span className="text-muted-foreground"> ({i.path})</span> : null}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
