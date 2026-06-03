import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CheckCircle, XCircle, Edit, Loader2 } from "lucide-react";
import type { ItemReviewState } from "./ReviewQueueItem";

interface ReviewActionsProps {
  itemId: string;
  organizationId: number;
  processId?: number;
  actorUserId: number;
  reviewState: ItemReviewState;
  onApprove: (id: string, orgId: number, processId: number, actorUserId: number) => void;
  onReject: (id: string, orgId: number, processId: number, actorUserId: number, reason: string) => void;
  onOverride: (
    id: string,
    orgId: number,
    processId: number,
    actorUserId: number,
    overrides: { quantity?: number; estimatedUnitPrice?: number; description?: string; canonicalUnit?: string },
    justification: string,
  ) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  isOverriding?: boolean;
}

export function ReviewActions({
  itemId,
  organizationId,
  processId = 1,
  actorUserId,
  reviewState,
  onApprove,
  onReject,
  onOverride,
  isApproving = false,
  isRejecting = false,
  isOverriding = false,
}: ReviewActionsProps) {
  const [rejectReason,  setRejectReason]  = useState("");
  const [rejectOpen,    setRejectOpen]    = useState(false);
  const [overrideOpen,  setOverrideOpen]  = useState(false);

  // Override fields
  const [overrideDescription, setOverrideDescription] = useState("");
  const [overrideQuantity,    setOverrideQuantity]    = useState("");
  const [overridePrice,       setOverridePrice]       = useState("");
  const [overrideUnit,        setOverrideUnit]        = useState("");
  const [overrideJustif,      setOverrideJustif]      = useState("");

  const canApprove = reviewState === "awaiting_review";

  function handleApprove() {
    onApprove(itemId, organizationId, processId, actorUserId);
  }

  function handleReject() {
    if (!rejectReason.trim()) return;
    onReject(itemId, organizationId, processId, actorUserId, rejectReason);
    setRejectReason("");
    setRejectOpen(false);
  }

  function handleOverride() {
    if (overrideJustif.trim().length < 5) return;
    const overrides: Record<string, string | number> = {};
    if (overrideDescription.trim()) overrides.description = overrideDescription.trim();
    if (overrideQuantity.trim())    overrides.quantity    = Number(overrideQuantity);
    if (overridePrice.trim())       overrides.estimatedUnitPrice = Number(overridePrice);
    if (overrideUnit.trim())        overrides.canonicalUnit = overrideUnit.trim();

    onOverride(itemId, organizationId, processId, actorUserId, overrides, overrideJustif.trim());
    setOverrideOpen(false);
    setOverrideJustif("");
    setOverrideDescription("");
    setOverrideQuantity("");
    setOverridePrice("");
    setOverrideUnit("");
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Approve */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="default"
            className="bg-green-600 hover:bg-green-700 text-white gap-1"
            disabled={!canApprove || isApproving}
          >
            {isApproving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
            Aprovar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Aprovação</AlertDialogTitle>
            <AlertDialogDescription>
              Você está aprovando este item para inclusão no Termo de Referência.
              Esta ação pode ser desfeita por override, mas ficará registrada no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove} className="bg-green-600 hover:bg-green-700">
              Confirmar Aprovação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            className="gap-1"
            disabled={isRejecting}
          >
            {isRejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
            Rejeitar
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar Item</DialogTitle>
            <DialogDescription>
              Informe o motivo da rejeição. O item será excluído da composição do TR.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reject-reason">Motivo *</Label>
            <Textarea
              id="reject-reason"
              placeholder="Descreva o motivo da rejeição..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || isRejecting}
            >
              {isRejecting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Confirmar Rejeição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 border-yellow-400 text-yellow-700 hover:bg-yellow-50"
            disabled={isOverriding}
          >
            {isOverriding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Edit className="h-3 w-3" />}
            Override
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Override Manual</DialogTitle>
            <DialogDescription>
              Sobrescreva os campos do item. Campos em branco mantêm o valor original.
              É obrigatório informar justificativa com no mínimo 5 caracteres.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="ov-description">Descrição</Label>
              <Textarea
                id="ov-description"
                placeholder="Nova descrição (opcional)"
                value={overrideDescription}
                onChange={e => setOverrideDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ov-quantity">Quantidade</Label>
                <Input
                  id="ov-quantity"
                  type="number"
                  min="0"
                  placeholder="Ex: 10"
                  value={overrideQuantity}
                  onChange={e => setOverrideQuantity(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ov-price">Preço Unitário (R$)</Label>
                <Input
                  id="ov-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex: 4500.00"
                  value={overridePrice}
                  onChange={e => setOverridePrice(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-unit">Unidade Canônica</Label>
              <Input
                id="ov-unit"
                placeholder="Ex: UN, KG, L"
                value={overrideUnit}
                onChange={e => setOverrideUnit(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-justif">Justificativa * (mín. 5 caracteres)</Label>
              <Textarea
                id="ov-justif"
                placeholder="Descreva o motivo do override..."
                value={overrideJustif}
                onChange={e => setOverrideJustif(e.target.value)}
                rows={2}
              />
              {overrideJustif.length > 0 && overrideJustif.length < 5 && (
                <p className="text-xs text-destructive">Justificativa muito curta ({overrideJustif.length}/5 chars)</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>Cancelar</Button>
            <Button
              variant="default"
              className="bg-yellow-500 hover:bg-yellow-600 text-white"
              onClick={handleOverride}
              disabled={overrideJustif.trim().length < 5 || isOverriding}
            >
              {isOverriding && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Confirmar Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
