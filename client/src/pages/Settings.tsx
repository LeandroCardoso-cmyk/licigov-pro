import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { useOrgRole } from "@/_core/hooks/useOrgRole";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { Loader2, Moon, Save, ShieldAlert, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Settings() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();
  // Identidade institucional documental é TENANT-SCOPED e restrita a admin/owner (o backend já
  // protege com orgRoleProcedure("admin")). Aqui é a experiência correta: operator/manager/viewer
  // NÃO editam a identidade da organização, e o acesso direto por URL cai em "Acesso não autorizado".
  const { canManageUsers, isLoading: roleLoading } = useOrgRole();
  const { resolvedTheme, toggleTheme } = useTheme();

  // Form state
  const [organizationName, setOrganizationName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [address, setAddress] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [footerText, setFooterText] = useState("");

  // tRPC queries and mutations — a leitura só dispara para quem pode gerenciar (evita FORBIDDEN
  // desnecessário para papéis sem permissão).
  const { data: settings, isLoading: loadingSettings, error, refetch } = trpc.documentSettings.get.useQuery(undefined, {
    retry: false,
    enabled: canManageUsers,
  });

  const saveMutation = trpc.documentSettings.save.useMutation({
    onSuccess: () => {
      toast.success("Configurações salvas com sucesso!");
    },
    onError: (e) => {
      toast.error("Não foi possível salvar as configurações institucionais.", {
        description: e.message,
      });
    },
  });

  // Load settings into form
  useEffect(() => {
    if (settings) {
      setOrganizationName(settings.organizationName || "");
      setLogoUrl(settings.logoUrl || "");
      setAddress(settings.address || "");
      setCnpj(settings.cnpj || "");
      setPhone(settings.phone || "");
      setEmail(settings.email || "");
      setWebsite(settings.website || "");
      setFooterText(settings.footerText || "");
    }
  }, [settings]);

  const handleSave = () => {
    saveMutation.mutate({
      organizationName,
      logoUrl,
      address,
      cnpj,
      phone,
      email,
      website,
      footerText,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    setLocation("/");
    return null;
  }

  // Guarda de papel (defense-in-depth junto ao backend): apenas admin/owner acessam a identidade
  // institucional. Acesso direto por URL sem papel → "Acesso não autorizado" (sem formulário).
  if (roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canManageUsers) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Acesso não autorizado</CardTitle>
            <CardDescription>
              As configurações institucionais dos documentos (nome, CNPJ, logo, rodapé) são
              restritas a administradores da organização. Fale com um administrador para ajustá-las.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Configurações</h1>
            <p className="text-muted-foreground">
              Personalize as informações da sua organização para documentos
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            title={resolvedTheme === "dark" ? "Modo Claro" : "Modo Escuro"}
          >
            {resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
        </div>

        {loadingSettings ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="pt-6 text-center space-y-3">
              <p className="text-muted-foreground">
                Não foi possível carregar as configurações institucionais.
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                Tentar novamente
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Informações da Organização</CardTitle>
              <CardDescription>
                Dados que aparecerão nos documentos gerados pelo sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="organizationName">Nome da Organização</Label>
                  <Input
                    id="organizationName"
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="Ex: Prefeitura Municipal"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cnpj">CNPJ</Label>
                  <Input
                    id="cnpj"
                    value={cnpj}
                    onChange={(e) => setCnpj(e.target.value)}
                    placeholder="00.000.000/0000-00"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Endereço Completo</Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Rua, Número, Bairro, Cidade - UF, CEP"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefone</Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(00) 0000-0000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contato@organizacao.gov.br"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://www.organizacao.gov.br"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Personalização Visual</CardTitle>
              <CardDescription>
                Logotipo e rodapé dos documentos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="logoUrl">URL do Logotipo</Label>
                <Input
                  id="logoUrl"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://exemplo.com/logo.png"
                />
                <p className="text-xs text-muted-foreground">
                  Recomendado: PNG ou SVG transparente, 200x200px
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="footerText">Texto do Rodapé</Label>
                <Textarea
                  id="footerText"
                  value={footerText}
                  onChange={(e) => setFooterText(e.target.value)}
                  placeholder="Texto que aparecerá no rodapé dos documentos"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button variant="outline" onClick={() => setLocation("/dashboard")}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Salvar Configurações
                </>
              )}
            </Button>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
