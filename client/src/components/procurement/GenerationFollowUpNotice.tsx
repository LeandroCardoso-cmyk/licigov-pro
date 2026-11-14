import type { FollowUpStatus } from "./generationFollowUp";

/**
 * M8 — estado informativo da geração acompanhada (nunca "sucesso" presumido nem erro falso): enquanto acompanha, diz que o
 * rascunho aparece aqui ao concluir; ao vencer o teto, oferece verificar de novo (leitura), sem reenviar a geração.
 */
export default function GenerationFollowUpNotice({ status, documentLabel, onCheckAgain }: {
  status: FollowUpStatus; documentLabel: string; onCheckAgain: () => void;
}) {
  if (status === "following") {
    return (
      <p className="mt-2 text-sm text-muted-foreground" role="status" aria-live="polite">
        Geração do {documentLabel} em andamento. O rascunho aparece aqui quando o servidor concluir — não é preciso clicar de novo.
      </p>
    );
  }
  if (status === "expired") {
    return (
      <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300" role="status">
        O rascunho do {documentLabel} ainda não apareceu. A geração pode continuar em processamento ou ter falhado.{" "}
        <button type="button" onClick={onCheckAgain} className="font-medium underline underline-offset-2">Verificar novamente</button>
      </div>
    );
  }
  return null;
}
