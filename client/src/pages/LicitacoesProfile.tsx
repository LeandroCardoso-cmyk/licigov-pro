import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrgRole } from "@/_core/hooks/useOrgRole";
import { Loader2, ShieldAlert } from "lucide-react";
import LicitacoesProfilePanel from "@/components/procurement/LicitacoesProfilePanel";
import { canGovernLicitacoesProfile, type OrgRole } from "@/utils/orgPermissions";

const ROLE_LABEL: Record<OrgRole, string> = { owner: "Proprietário", admin: "Administrador", manager: "Gestor", operator: "Operador", viewer: "Visualizador" };

/** Aviso para quem não governa o Perfil (sem formulário, sem leitura extra, sem privilégio adicional). Puro (testável em SSR). */
export function LicitacoesProfileAccessDenied({ role }: { role: OrgRole | null }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center" data-profile-access="denied">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Acesso restrito ao Perfil de Licitações</CardTitle>
          <CardDescription>
            O Perfil de Licitações do órgão (papéis, políticas e padrões) é mantido por Gestores e Administradores da organização.
            {role ? ` Seu papel neste órgão: ${ROLE_LABEL[role]}.` : ""} Fale com um Gestor ou Administrador para registrar o que falta.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

/**
 * F1 (homologação H5) — Perfil institucional de Licitações em rota PRÓPRIA (`/perfil-licitacoes`): o MESMO painel de Configurações
 * (`LicitacoesProfilePanel`), acessível a quem o backend autoriza a governá-lo (`manager`+), sem abrir Configurações (identidade
 * institucional/documental e usuários seguem restritos a admin/owner). Organização = a ativa (o backend resolve o tenant e reautoriza
 * cada leitura/escrita; a membership real é exigida na gravação).
 */
export default function LicitacoesProfilePage() {
  const { role, isLoading } = useOrgRole();
  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!canGovernLicitacoesProfile(role)) return <LicitacoesProfileAccessDenied role={role} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <Card>
        <CardHeader>
          <CardTitle>Perfil de Licitações do órgão</CardTitle>
          <CardDescription>
            Configure uma única vez: papéis (autoridade competente, pregoeiro, assinante do Edital…), políticas, Perfil da plataforma (endereço e regulamento) e padrões do órgão. Cada novo Edital reutiliza estes dados — nenhum processo os pede de novo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LicitacoesProfilePanel />
        </CardContent>
      </Card>
    </div>
  );
}
