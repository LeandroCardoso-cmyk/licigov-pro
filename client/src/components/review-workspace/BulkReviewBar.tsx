import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface BulkReviewBarProps {
  selectedCount: number;
  onBulkApprove: () => void;
  onBulkReject: () => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

export function BulkReviewBar({
  selectedCount,
  onBulkApprove,
  onBulkReject,
  isApproving = false,
  isRejecting = false,
}: BulkReviewBarProps) {
  if (selectedCount < 2) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 bg-background border-t px-6 py-3 shadow-lg">
      <span className="text-sm font-medium">
        {selectedCount} {selectedCount === 1 ? "item selecionado" : "itens selecionados"}
      </span>
      <div className="flex items-center gap-2">
        {/* Bulk Approve */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white gap-1"
              disabled={isApproving}
            >
              {isApproving
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <CheckCircle className="h-3 w-3" />
              }
              Aprovar Todos
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Aprovar {selectedCount} Itens</AlertDialogTitle>
              <AlertDialogDescription>
                Você está aprovando {selectedCount} itens em lote. Itens que não puderem ser aprovados
                (ex: já rejeitados) serão listados como falha. Deseja continuar?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={onBulkApprove}
                className="bg-green-600 hover:bg-green-700"
              >
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Reject */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1"
              disabled={isRejecting}
            >
              {isRejecting
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <XCircle className="h-3 w-3" />
              }
              Rejeitar Todos
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rejeitar {selectedCount} Itens</AlertDialogTitle>
              <AlertDialogDescription>
                Você está rejeitando {selectedCount} itens em lote. Esta ação ficará registrada no histórico.
                Deseja continuar?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={onBulkReject}
                className="bg-destructive"
              >
                Confirmar Rejeição
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
