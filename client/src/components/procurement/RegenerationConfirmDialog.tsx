import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describeHumanEdit, type DraftHumanEdit } from "./regenerationGuard";

/**
 * PR-09 (SEM-014 / SEM-009) — confirmação EXPLÍCITA antes de regenerar sobre conteúdo humano e/ou trocar
 * parâmetros do Edital. Explica o que será substituído (origem + quando + tamanho do conteúdo atual) e
 * oferece "Continuar editando" como ação padrão. O conteúdo atual fica preservado no histórico (ledger).
 */
export type RegenerationConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "ETP" | "TR" | "Edital" */
  documentLabel: string;
  /** Proveniência humana do conteúdo vigente (null = só troca de parâmetros). */
  humanEdit: DraftHumanEdit;
  /** Tamanho do conteúdo atual (resumo mínimo do que será substituído). */
  currentLength?: number;
  /** Troca de parâmetros do Edital (atual × proposto), quando houver. */
  parameterChange?: { current: string; proposed: string } | null;
  pending?: boolean;
  onConfirm: () => void;
};

export default function RegenerationConfirmDialog({
  open, onOpenChange, documentLabel, humanEdit, currentLength, parameterChange, pending, onConfirm,
}: RegenerationConfirmDialogProps) {
  const replacing = !!humanEdit;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {replacing ? `Substituir o rascunho do ${documentLabel}?` : `Trocar os parâmetros do ${documentLabel}?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {replacing && (
                <p>
                  O rascunho atual contém <strong>{describeHumanEdit(humanEdit)}</strong>
                  {typeof currentLength === "number" ? ` (${currentLength.toLocaleString("pt-BR")} caracteres)` : ""}.
                  Gerar novamente substituirá esse conteúdo por um novo rascunho de IA, que exigirá revisão humana.
                </p>
              )}
              {parameterChange && (
                <p>
                  Parâmetros: atual <strong>{parameterChange.current}</strong> → proposto{" "}
                  <strong>{parameterChange.proposed}</strong>.
                </p>
              )}
              <p>
                A versão atual fica preservada no histórico de edições. Alterações ainda não salvas no editor serão
                perdidas — salve-as antes, se quiser mantê-las.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar editando</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            {replacing ? "Substituir e gerar" : "Trocar parâmetros e gerar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
