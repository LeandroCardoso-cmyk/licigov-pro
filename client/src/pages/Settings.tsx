import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { APP_LOGO } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { ArrowLeft, Loader2, Moon, Save, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Settings() {
  const [, setLocation] = useLocation();
  const { user, loading, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Form state
  const [organizationName, setOrganizationName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [address, setAddress] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [footerText, setFooterText] = useState("");

  // tRPC queries and mutations
  const { data: settings, isLoading: loadingSettings } = trpc.documentSettings.get.useQuery();
  const saveMutation = trpc.documentSettings.save.useMutation({
    onSuccess: () => {
      toast.success("Configurações salvas com sucesso!");
    },
    onError: (error) => {
      toast.error(`Erro ao salvar configurações: ${error.message}`);
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

  if (loading || loadingSettings) {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 dark:from-slate-950 dark:via-blue-950 dark:to-slate-900">
      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src={APP_LOGO} alt="LiciGov Pro" className="h-20 md:h-24" />
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">LiciGov Pro</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">Automação de Processos Licitatórios</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>

            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm font-medium text-slate-900 dark:text-white">{user.name}</span>
              <span className="text-xs text-slate-600 dark:text-slate-400">{user.email}</span>
            </div>

            <Button variant="ghost" size="sm" onClick={logout}>
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <Button variant="ghost" className="mb-6" onClick={() => setLocation("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar aos Módulos
        </Button>

        <div className="space-y-6">
          <div>
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Configurações de Documentos</h2>
            <p className="text-slate-600 dark:text-slate-400 mt-2">
              Personalize o cabeçalho e rodapé dos documentos gerados (ETP, TR, DFD, Edital)
            </p>
          </div>

          {/* Cabeçalho */}
          <Card>
            <CardHeader>
              <CardTitle>Cabeçalho dos Documentos</CardTitle>
              <CardDescription>
                Informações que aparecerão no topo de todos os documentos gerados
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="organizationName">Nome do Órgão *</Label>
                <Input
                  id="organizationName"
                  placeholder="Ex: Prefeitura Municipal de..."
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="logoUrl">URL do Brasão/Logo</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  placeholder="https://exemplo.com/brasao.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
                <p className="text-xs text-slate-500">
                  Cole a URL de uma imagem hospedada online (PNG, JPG ou SVG)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Endereço Completo</Label>
                <Textarea
                  id="address"
                  placeholder="Rua, número, bairro, cidade - UF, CEP"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cnpj">CNPJ</Label>
                <Input
                  id="cnpj"
                  placeholder="00.000.000/0000-00"
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  maxLength={18}
                />
              </div>
            </CardContent>
          </Card>

          {/* Rodapé */}
          <Card>
            <CardHeader>
              <CardTitle>Rodapé dos Documentos</CardTitle>
              <CardDescription>
                Informações de contato que aparecerão no final de todos os documentos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input
                  id="phone"
                  placeholder="(00) 0000-0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="contato@orgao.gov.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  type="url"
                  placeholder="https://www.orgao.gov.br"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="footerText">Texto Customizável do Rodapé</Label>
                <Textarea
                  id="footerText"
                  placeholder="Texto adicional que deseja incluir no rodapé (opcional)"
                  value={footerText}
                  onChange={(e) => setFooterText(e.target.value)}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Botão Salvar */}
          <div className="flex justify-end">
            <Button 
              size="lg" 
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
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
      </main>
    </div>
  );
}
