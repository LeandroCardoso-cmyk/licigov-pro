/**
 * C.3A-OPS.1 — Superfície operacional (platform admin) para a flag FF_DIRECT_CONTRACT_SHADOW.
 *
 * Menor superfície possível: consulta o estado tenant-aware, e ativa/desativa a flag para UMA
 * organização — EXCLUSIVAMENTE via `trpc.featureFlagAdmin.getTenantFlag` / `setTenantFlag`.
 * Nenhuma chamada direta a DB/service, nenhuma flag arbitrária, nenhum rollout %, nenhum ENV/Railway.
 * A autoridade de escrita vem do backend (`writeAllowed`, derivado de IS_PRODUCTION) — a UI não decide
 * pelo hostname. Em produção os controles ficam desabilitados; o backend mantém o FORBIDDEN de qualquer forma.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldAlert, FlaskConical } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  SHADOW_FLAG,
  environmentLabel,
  canOperate,
  validateActivation,
  validateDeactivation,
  buildConfirmationSummary,
  PRODUCTION_WRITE_BLOCKED_MESSAGE,
  ACTIVATION_NOTICE,
  DEFAULT_ACTIVATION_REASON,
  DEFAULT_DEACTIVATION_REASON,
  type ValidationResult,
} from "@/lib/featureFlags/shadowFlagSurface";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: number | null;
  organizationName: string;
}

type PendingAction = { kind: "activate" | "deactivate" } | null;

export function FeatureFlagShadowDialog({ open, onOpenChange, organizationId, organizationName }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [errors, setErrors] = useState<ValidationResult["errors"]>({});

  const flagQuery = trpc.featureFlagAdmin.getTenantFlag.useQuery(
    { organizationId: organizationId ?? 0, flagName: SHADOW_FLAG },
    { enabled: open && isAdmin && !!organizationId },
  );

  const setMutation = trpc.featureFlagAdmin.setTenantFlag.useMutation({
    onSuccess: (res) => {
      toast.success(res.after.enabled ? "Shadow ativado para esta organização." : "Shadow desativado para esta organização.");
      setPending(null);
      setErrors({});
      flagQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  // Reabrir o diálogo em outra org reinicia o formulário (nada persiste no browser).
  useEffect(() => {
    if (!open) {
      setReason("");
      setExpiresAt("");
      setPending(null);
      setErrors({});
    }
  }, [open, organizationId]);

  const view = flagQuery.data;
  const writeAllowed = canOperate(view);
  const busy = setMutation.isPending;

  const startActivate = () => {
    const result = validateActivation({ reason: reason || DEFAULT_ACTIVATION_REASON, expiresAt });
    setErrors(result.errors);
    if (result.valid) setPending({ kind: "activate" });
  };

  const startDeactivate = () => {
    const result = validateDeactivation({ reason: reason || DEFAULT_DEACTIVATION_REASON });
    setErrors(result.errors);
    if (result.valid) setPending({ kind: "deactivate" });
  };

  const confirm = () => {
    if (!organizationId || !pending || busy) return; // guarda de double-submit
    if (pending.kind === "activate") {
      setMutation.mutate({
        organizationId,
        flagName: SHADOW_FLAG,
        enabled: true,
        reason: (reason || DEFAULT_ACTIVATION_REASON).trim(),
        expiresAt: new Date(expiresAt),
        idempotencyKey: crypto.randomUUID(), // chave única por operação
      });
    } else {
      setMutation.mutate({
        organizationId,
        flagName: SHADOW_FLAG,
        enabled: false,
        reason: (reason || DEFAULT_DEACTIVATION_REASON).trim(),
        idempotencyKey: crypto.randomUUID(),
      });
    }
  };

  const confirmationSummary =
    view && pending
      ? buildConfirmationSummary({
          environment: view.environment,
          organizationName,
          reason: pending.kind === "activate" ? reason || DEFAULT_ACTIVATION_REASON : reason || DEFAULT_DEACTIVATION_REASON,
          expiresAt: pending.kind === "activate" ? expiresAt : null,
        })
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Feature flags — {organizationName}
          </DialogTitle>
          <DialogDescription>
            Controle operacional supervisionado do shadow do Kernel Cognitivo. Somente admin de plataforma.
          </DialogDescription>
        </DialogHeader>

        {!isAdmin ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Acesso restrito</AlertTitle>
            <AlertDescription>Esta ação é exclusiva do administrador de plataforma.</AlertDescription>
          </Alert>
        ) : flagQuery.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : flagQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível consultar a flag</AlertTitle>
            <AlertDescription>{flagQuery.error.message}</AlertDescription>
          </Alert>
        ) : view ? (
          <div className="space-y-4">
            {/* Estado atual */}
            <div className="rounded-md border p-3 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={view.effectiveValue ? "default" : "outline"}>
                  {view.effectiveValue ? "SHADOW ON" : "SHADOW OFF"}
                </Badge>
                <Badge variant={view.environment === "production" ? "destructive" : "secondary"}>
                  {environmentLabel(view.environment).toUpperCase()}
                </Badge>
                <span className="text-muted-foreground">origem: <b>{view.origin}</b></span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <span>Flag</span><span className="font-mono text-foreground">{view.flagName}</span>
                <span>organizationId</span><span className="text-foreground">{view.organizationId}</span>
                <span>enabled (override)</span><span className="text-foreground">{view.override ? String(view.override.enabled) : "—"}</span>
                <span>expira em</span>
                <span className="text-foreground">
                  {view.override?.expiresAt ? new Date(view.override.expiresAt).toLocaleString("pt-BR") : "—"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                O shadow é apenas paralelo: o resultado legado continua sendo o resultado oficial ao usuário.
              </p>
            </div>

            {!writeAllowed && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Escrita bloqueada</AlertTitle>
                <AlertDescription>{PRODUCTION_WRITE_BLOCKED_MESSAGE}</AlertDescription>
              </Alert>
            )}

            {/* Confirmação institucional */}
            {pending && confirmationSummary ? (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2 text-sm">
                <p className="font-medium text-foreground">
                  {pending.kind === "activate" ? "Confirmar ativação do shadow" : "Confirmar desativação do shadow"}
                </p>
                {pending.kind === "activate" && <p className="text-muted-foreground">{ACTIVATION_NOTICE}</p>}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="text-muted-foreground">Ambiente</span><span className="text-foreground">{confirmationSummary.environment}</span>
                  <span className="text-muted-foreground">Organização</span><span className="text-foreground">{confirmationSummary.organization}</span>
                  <span className="text-muted-foreground">Flag</span><span className="font-mono text-foreground">{confirmationSummary.flag}</span>
                  {confirmationSummary.expiry && (<><span className="text-muted-foreground">Expira em</span><span className="text-foreground">{confirmationSummary.expiry}</span></>)}
                  <span className="text-muted-foreground">Justificativa</span><span className="text-foreground">{confirmationSummary.reason}</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={confirm} disabled={busy}>
                    {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    {pending.kind === "activate" ? "Confirmar ativação" : "Confirmar desativação"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={busy}>Cancelar</Button>
                </div>
              </div>
            ) : writeAllowed ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="ff-reason">Justificativa (obrigatória)</Label>
                  <Textarea
                    id="ff-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={view.effectiveValue ? DEFAULT_DEACTIVATION_REASON : DEFAULT_ACTIVATION_REASON}
                    rows={2}
                  />
                  {errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ff-expiry">Expiração (obrigatória para ativação — safety net)</Label>
                  <Input id="ff-expiry" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                  {errors.expiresAt && <p className="text-xs text-destructive">{errors.expiresAt}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={startActivate} disabled={busy}>Ativar shadow</Button>
                  <Button size="sm" variant="outline" onClick={startDeactivate} disabled={busy}>Desativar shadow</Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
