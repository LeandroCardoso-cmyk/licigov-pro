import type { TemplateResolutionView, TrCandidateView } from "@/lib/editalTemplateBridge";
import { NOT_BOUND_MESSAGE, TR_REQUIRED_MESSAGE, scopeLabel, shortHash } from "@/lib/editalTemplateBridge";

export interface EditalTemplateBridgeCardProps {
  resolution: TemplateResolutionView | undefined;
  candidates: readonly TrCandidateView[];
  selectedTrId: string | null;
  onSelectTr: (documentId: string | null) => void;
  candidatesLoading?: boolean;
}

/**
 * Mostra, ANTES de gerar, qual motor o servidor usará: modelo institucional (BOUND) ou o fluxo governado atual. Em BOUND exige a
 * confirmação humana do TR oficial EXATO (versão + hash vêm do servidor). Presentacional: não decide nada.
 */
export default function EditalTemplateBridgeCard({ resolution, candidates, selectedTrId, onSelectTr, candidatesLoading = false }: EditalTemplateBridgeCardProps) {
  if (!resolution || resolution.status === "FEATURE_OFF") return null;
  if (resolution.status === "NOT_BOUND") {
    if (resolution.reason !== "NO_BINDING") return null; // parâmetros incompletos / sem slug institucional: nada a anunciar
    return <p role="status" className="text-xs text-muted-foreground">{NOT_BOUND_MESSAGE}</p>;
  }
  if (resolution.status === "CONFLICT" || resolution.status === "INVALID") {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <strong>{resolution.status === "CONFLICT" ? "Conflito de vínculos." : "Vínculo inválido."}</strong>{" "}
        {resolution.status === "CONFLICT"
          ? "Há mais de um modelo institucional vigente para este escopo; nenhum é escolhido automaticamente. A geração está bloqueada."
          : `O vínculo do modelo institucional não é válido (${resolution.codes.join(", ")}). A geração está bloqueada.`}
      </div>
    );
  }
  const t = resolution.template;
  const selectable = candidates.filter((c) => c.current);
  return (
    <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm" aria-label="Modelo institucional aplicado">
      <div>
        <p className="font-semibold text-foreground">Modelo institucional aplicado</p>
        <p className="text-foreground">{t.displayName}</p>
        <p className="text-xs text-muted-foreground">Revisão {t.revision} · {shortHash(t.semanticHash)}</p>
        <p className="text-xs text-muted-foreground">Escopo {scopeLabel(t.scope)}</p>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-foreground">TR oficial exato (confirme a versão que serve de base)</legend>
        {candidatesLoading ? <p className="text-xs text-muted-foreground">Carregando TR oficial…</p>
          : candidates.length === 0 ? <p role="alert" className="text-xs text-destructive">TR_OFICIAL_EXATO_NECESSARIO — {TR_REQUIRED_MESSAGE}</p>
          : (
            <ul className="space-y-1">
              {candidates.map((c) => (
                <li key={c.documentId}>
                  <label className="flex items-start gap-2 text-xs">
                    <input type="radio" name="edital-tr-pin" disabled={!c.current} checked={selectedTrId === c.documentId} onChange={() => onSelectTr(c.documentId)} />
                    <span>
                      {c.title} · v{c.version} · {shortHash(c.contentHash)} · {c.status} · {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                      {!c.current && <em className="ml-1 text-muted-foreground">(obsoleta — existe versão mais recente)</em>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        {candidates.length > 0 && selectable.length === 0 && <p className="text-xs text-destructive">Nenhuma versão vigente do TR oficial.</p>}
      </fieldset>
      <p className="text-xs text-muted-foreground">O rascunho será composto pelo modelo institucional e continua editável; a revisão humana é obrigatória antes da emissão.</p>
    </div>
  );
}
