import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Building2, Loader2, Flag } from "lucide-react";
import { translateAuthError } from "@/utils/authErrorMessages";
import { SELECTED_ORGANIZATION_ID_STORAGE_KEY } from "@/const";
import { slugify } from "@/utils/slugify";
import { FeatureFlagShadowDialog } from "@/components/admin/FeatureFlagShadowDialog";

const ESFERA_LABELS: Record<string, string> = {
  federal: "Federal",
  estadual: "Estadual",
  municipal: "Municipal",
  outro: "Outro",
};

const EMPTY_FORM = {
  nome: "",
  slug: "",
  cnpj: "",
  esfera: "municipal" as "federal" | "estadual" | "municipal" | "outro",
  uf: "",
  municipio: "",
  firstAdminName: "",
  firstAdminEmail: "",
};

export default function AdminOrganizacoes() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [form, setForm] = useState(EMPTY_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ organizationName: string; alreadyExisted: boolean } | null>(null);
  const [flagOrg, setFlagOrg] = useState<{ id: number; nome: string } | null>(null);

  const orgsQuery = trpc.organizations.adminList.useQuery(undefined, { enabled: user?.role === "admin" });

  const onboardMutation = trpc.tenantOnboarding.create.useMutation({
    onSuccess: (result) => {
      setSuccess({ organizationName: result.organizationName, alreadyExisted: result.alreadyExisted });
      toast.success(result.alreadyExisted ? "Organização já existia — nenhum convite novo foi enviado." : "Organização criada e convite enviado ao 1º administrador.");
      setForm(EMPTY_FORM);
      setSlugTouched(false);
      utils.organizations.adminList.invalidate();
    },
    onError: (err) => setError(translateAuthError(err.message)),
  });

  if (user && user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Acesso restrito</CardTitle>
            <CardDescription>Esta área é exclusiva do administrador de plataforma.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const handleNomeChange = (value: string) => {
    setForm(f => ({ ...f, nome: value, slug: slugTouched ? f.slug : slugify(value) }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(null);
    onboardMutation.mutate({
      nome: form.nome,
      slug: form.slug,
      cnpj: form.cnpj || undefined,
      esfera: form.esfera,
      uf: form.uf || undefined,
      municipio: form.municipio || undefined,
      firstAdminName: form.firstAdminName,
      firstAdminEmail: form.firstAdminEmail,
    });
  };

  const handleManageUsers = (organizationId: number) => {
    localStorage.setItem(SELECTED_ORGANIZATION_ID_STORAGE_KEY, String(organizationId));
    navigate("/usuarios");
  };

  return (
    <div className="bg-background">
      <PageHeader
        icon={Building2}
        breadcrumbs={[{ label: "Organizações" }]}
        title="Organizações"
        description="Onboarding de novos órgãos e visão geral de tenants (admin de plataforma)."
      />

      <div className="container py-6 space-y-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Cadastrar nova organização
            </CardTitle>
            <CardDescription>
              Cria a organização e envia um convite de proprietário(a) para o primeiro administrador.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome do órgão</Label>
                  <Input id="nome" value={form.nome} onChange={(e) => handleNomeChange(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Identificador (slug)</Label>
                  <Input
                    id="slug"
                    value={form.slug}
                    onChange={(e) => { setSlugTouched(true); setForm(f => ({ ...f, slug: e.target.value })); }}
                    pattern="[a-z0-9-]+"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="esfera">Esfera</Label>
                  <Select value={form.esfera} onValueChange={(v) => setForm(f => ({ ...f, esfera: v as typeof f.esfera }))}>
                    <SelectTrigger id="esfera"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ESFERA_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uf">UF</Label>
                  <Input id="uf" value={form.uf} onChange={(e) => setForm(f => ({ ...f, uf: e.target.value.toUpperCase() }))} maxLength={2} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="municipio">Município</Label>
                  <Input id="municipio" value={form.municipio} onChange={(e) => setForm(f => ({ ...f, municipio: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cnpj">CNPJ (opcional)</Label>
                <Input id="cnpj" value={form.cnpj} onChange={(e) => setForm(f => ({ ...f, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" />
              </div>

              <div className="border-t pt-4 space-y-4">
                <p className="text-sm font-medium text-foreground">Primeiro administrador</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstAdminName">Nome</Label>
                    <Input id="firstAdminName" value={form.firstAdminName} onChange={(e) => setForm(f => ({ ...f, firstAdminName: e.target.value }))} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="firstAdminEmail">E-mail</Label>
                    <Input id="firstAdminEmail" type="email" value={form.firstAdminEmail} onChange={(e) => setForm(f => ({ ...f, firstAdminEmail: e.target.value }))} required />
                  </div>
                </div>
              </div>

              {error && <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</p>}
              {success && (
                <p className="text-sm text-foreground bg-primary/10 p-3 rounded-md">
                  {success.alreadyExisted
                    ? `"${success.organizationName}" já existia — nenhuma alteração foi feita.`
                    : `"${success.organizationName}" criada. O convite foi enviado ao e-mail informado.`}
                </p>
              )}

              <Button type="submit" size="lg" disabled={onboardMutation.isPending}>
                {onboardMutation.isPending ? "Criando..." : "Criar organização"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organizações cadastradas</CardTitle>
          </CardHeader>
          <CardContent>
            {orgsQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Esfera</TableHead>
                    <TableHead>UF/Município</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(orgsQuery.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Nenhuma organização cadastrada.
                      </TableCell>
                    </TableRow>
                  )}
                  {(orgsQuery.data ?? []).map(org => (
                    <TableRow key={org.id}>
                      <TableCell className="font-medium">{org.nome}</TableCell>
                      <TableCell className="text-muted-foreground">{org.slug}</TableCell>
                      <TableCell>{ESFERA_LABELS[org.esfera ?? ""] ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {[org.uf, org.municipio].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={org.ativo ? "default" : "outline"}>{org.ativo ? "Ativa" : "Inativa"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setFlagOrg({ id: org.id, nome: org.nome })}>
                          <Flag className="h-4 w-4 mr-1" />
                          Feature flags
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleManageUsers(org.id)}>
                          Gerenciar usuários
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <FeatureFlagShadowDialog
        open={flagOrg !== null}
        onOpenChange={(o) => { if (!o) setFlagOrg(null); }}
        organizationId={flagOrg?.id ?? null}
        organizationName={flagOrg?.nome ?? ""}
      />
    </div>
  );
}
