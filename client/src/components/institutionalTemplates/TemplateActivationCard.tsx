/**
 * Ativação/desativação governada dos Modelos Institucionais (platform admin). Menor superfície possível:
 * `featureFlagAdmin.getTenantFlag` (leitura) e `featureFlagAdmin.setTenantFlag` (escrita) para UMA flag fixa e o tenant
 * autenticado (organizationId recebido de `getCapabilities`, nunca digitado). Sem controle de flag arbitrária.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldAlert, Power } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { environmentLabel } from "@/lib/featureFlags/shadowFlagSurface";
import {
  TEMPLATES_ACTIVATION_NOTICE, TEMPLATES_DISABLED_MESSAGE, TEMPLATES_ENABLED_MESSAGE, TEMPLATES_FLAG, TEMPLATES_WRITE_BLOCKED_MESSAGE,
  buildTemplatesFlagRequest, canMutateTemplatesFlag, canSeeTemplatesFlagControl, validateTemplatesFlagReason,
} from "@/lib/featureFlags/templatesFlagSurface";

export interface TemplateActivationCardProps {
  /** Tenant AUTENTICADO (vem de `institutionalTemplates.getCapabilities`; nunca digitado). */
  organizationId: number;
  enabled: boolean;
  onChanged: () => void;
}

export function TemplateActivationCard({ organizationId, enabled, onChanged }: TemplateActivationCardProps) {
  const { user } = useAuth();
  const isAdmin = canSeeTemplatesFlagControl(user?.role);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const flag = trpc.featureFlagAdmin.getTenantFlag.useQuery({ organizationId, flagName: TEMPLATES_FLAG }, { enabled: isAdmin });
  const set = trpc.featureFlagAdmin.setTenantFlag.useMutation({
    onSuccess: (res) => {
      toast.success(res.after.enabled ? TEMPLATES_ENABLED_MESSAGE : TEMPLATES_DISABLED_MESSAGE);
      setConfirming(false); setReason(""); setError(undefined);
      void flag.refetch();
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!isAdmin) return null;
  const view = flag.data;
  const mutable = canMutateTemplatesFlag(view);
  const target = !(view?.effectiveValue ?? enabled);   // alvo da operação: ligar quando está OFF, desligar quando está ON
  const verb = target ? "Ativar" : "Desativar";

  const start = () => {
    const v = validateTemplatesFlagReason(reason);
    setError(v.error);
    if (v.valid) setConfirming(true);
  };
  const confirm = () => {
    if (!view || set.isPending || !mutable) return;
    set.mutate(buildTemplatesFlagRequest({ organizationId, enabled: target, reason, idempotencyKey: crypto.randomUUID() }));
  };

  return (
    <Card aria-label={target ? "Ativar Modelos Institucionais" : "Desativar Modelos Institucionais"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Power className="h-4 w-4" />{verb} Modelos Institucionais</CardTitle>
        <CardDescription>{TEMPLATES_ACTIVATION_NOTICE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {flag.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          : flag.isError ? <p role="alert" className="text-destructive">Não foi possível consultar a flag: {flag.error.message}</p>
          : view ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={view.effectiveValue ? "default" : "outline"}>{view.effectiveValue ? "ATIVO" : "INATIVO"}</Badge>
                <Badge variant={view.environment === "production" ? "destructive" : "secondary"}>{environmentLabel(view.environment).toUpperCase()}</Badge>
                <span className="text-muted-foreground">origem: <b>{view.origin}</b></span>
                <span className="text-muted-foreground">escrita permitida: <b>{view.writeAllowed ? "sim" : "não"}</b></span>
                <span className="text-muted-foreground">organização: <b>{view.organizationId}</b></span>
              </div>
              <p className="font-mono text-xs text-muted-foreground">{TEMPLATES_FLAG}</p>
              {!mutable ? (
                <p role="alert" className="flex items-center gap-2 text-destructive"><ShieldAlert className="h-4 w-4" />{TEMPLATES_WRITE_BLOCKED_MESSAGE}</p>
              ) : confirming ? (
                <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                  <p className="font-medium">Confirmar: {verb.toLowerCase()} {TEMPLATES_FLAG} para a organização {organizationId}</p>
                  <p className="text-muted-foreground">Justificativa: {reason.trim()}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={confirm} disabled={set.isPending}>{set.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confirmar {verb.toLowerCase()}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={set.isPending}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="tplflag-reason">Justificativa (obrigatória)</Label>
                  <Textarea id="tplflag-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                  {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                  <Button size="sm" variant={target ? "default" : "outline"} onClick={start}>{verb} Modelos Institucionais</Button>
                </div>
              )}
            </>
          ) : null}
      </CardContent>
    </Card>
  );
}
