import { READINESS_ANCHOR, type GenerationCta } from "@/lib/editalReadiness";

export interface EditalGenerateCtaProps {
  /** Prontidão da preparação (`null` ⇒ ainda sem estado: o botão segue só as demais regras). */
  cta: GenerationCta | null;
  /** Soma das regras existentes do botão (processo, parâmetros, ponte do TR, preflight, regeneração…). O backend segue fail closed. */
  disabled: boolean;
  pending: boolean;
  bound: boolean;
  /** Motivo visível quando a geração está desabilitada. */
  reason?: string;
  onGenerate: () => void;
}

/**
 * CTA ciente de prontidão. Com pendências: o protagonismo é "Resolver pendências" (navegação para a prontidão — nenhuma escrita) e o botão
 * de geração continua existindo, DESABILITADO, com o motivo visível e associado por `aria-describedby`. Com prontidão completa a geração
 * assume o protagonismo. Presentacional: não decide autoridade.
 */
export default function EditalGenerateCta({ cta, disabled, pending, bound, reason, onGenerate }: EditalGenerateCtaProps) {
  const resolving = cta?.primary === "RESOLVE_PENDING";
  return (
    <>
      {resolving && (
        <a href={`#${READINESS_ANCHOR}`} className="inline-block w-full rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:w-auto">{cta.primaryLabel}</a>
      )}
      <button
        type="button"
        onClick={onGenerate}
        aria-describedby={reason ? "edital-generate-reason" : undefined}
        disabled={disabled || resolving}
        className={`w-full rounded-lg px-4 py-2 text-sm font-medium disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground sm:w-auto ${resolving ? "border border-input bg-transparent text-muted-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
      >
        {pending ? "Gerando..." : bound ? "Gerar edital com modelo institucional" : "Gerar edital"}
      </button>
      {reason && <p id="edital-generate-reason" className="text-xs text-amber-600 dark:text-amber-400">{reason}</p>}
    </>
  );
}
