import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { APP_LOGO, APP_TITLE } from "@/const";
import { validateCNPJ } from "@/lib/validateCNPJ";

export default function DocumentSettings() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const { data: settings, isLoading } = trpc.documentSettings.get.useQuery();
  const [formData, setFormData] = useState({
    organizationName: "",
    cnpj: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    logoUrl: "",
    footerText: "",
  });

  const updateSettingsMutation = trpc.documentSettings.save.useMutation({
    onSuccess: () => {
      toast.success("Configurações salvas com sucesso!", {
        description: "As alterações serão aplicadas aos próximos documentos gerados.",
      });
    },
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        organizationName: settings.organizationName || "",
        cnpj: settings.cnpj || "",
        address: settings.address || "",
        phone: settings.phone || "",
        email: settings.email || "",
        website: settings.website || "",
        logoUrl: settings.logoUrl || "",
        footerText: settings.footerText || "",
      });
    }
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validar CNPJ se preenchido
    if (formData.cnpj && !validateCNPJ(formData.cnpj)) {
      toast.error("CNPJ inválido", {
        description: "Por favor, verifique o CNPJ informado.",
      });
      return;
    }
    
    updateSettingsMutation.mutate(formData);
  };

  const formatCNPJ = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 14) {
      return numbers
        .replace(/(\d{2})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1/$2")
        .replace(/(\d{4})(\d)/, "$1-$2");
    }
    return value;
  };

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 11) {
      return numbers
        .replace(/(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{5})(\d)/, "$1-$2");
    }
    return value;
  };

  const handleCNPJChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCNPJ(e.target.value);
    setFormData({ ...formData, cnpj: formatted });
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setFormData({ ...formData, phone: formatted });
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-gradient-to-r from-card via-card to-primary/5">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/")}
                className="rounded-full flex-shrink-0"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <img src={APP_LOGO} alt={APP_TITLE} className="h-12 w-auto flex-shrink-0" />
              <div>
                <h1 className="text-lg md:text-xl font-bold text-foreground">Personalização de Documentos</h1>
                <p className="text-xs md:text-sm text-muted-foreground">Configure as informações que aparecerão nos documentos</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-foreground">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
              <Button variant="outline" size="sm" onClick={logout}>
                Sair
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Informações da Organização */}
            <Card>
              <CardHeader>
                <CardTitle>Informações da Organização</CardTitle>
                <CardDescription>
                  Dados que aparecerão nos documentos gerados pelo sistema
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="organizationName">Nome da Organização</Label>
                    <Input
                      id="organizationName"
                      placeholder="Ex: Prefeitura Municipal"
                      value={formData.organizationName}
                      onChange={(e) => setFormData({ ...formData, organizationName: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cnpj">CNPJ</Label>
                    <Input
                      id="cnpj"
                      placeholder="00.000.000/0000-00"
                      value={formData.cnpj}
                      onChange={handleCNPJChange}
                      maxLength={18}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Endereço Completo</Label>
                  <Input
                    id="address"
                    placeholder="Rua, Número, Bairro, Cidade - UF, CEP"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefone</Label>
                    <Input
                      id="phone"
                      placeholder="(00) 00000-0000"
                      value={formData.phone}
                      onChange={handlePhoneChange}
                      maxLength={15}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="contato@organizacao.gov.br"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    type="url"
                    placeholder="https://www.organizacao.gov.br"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Personalização Visual */}
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
                    type="url"
                    placeholder="https://exemplo.com/logo.png"
                    value={formData.logoUrl}
                    onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Recomendado: PNG ou SVG transparente, 200x200px
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="footerText">Texto do Rodapé</Label>
                  <Textarea
                    id="footerText"
                    placeholder="Texto que aparecerá no rodapé dos documentos"
                    value={formData.footerText}
                    onChange={(e) => setFormData({ ...formData, footerText: e.target.value })}
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Botões */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/")}
                disabled={updateSettingsMutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={updateSettingsMutation.isPending}>
                {updateSettingsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Save className="mr-2 h-4 w-4" />
                Salvar Configurações
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
