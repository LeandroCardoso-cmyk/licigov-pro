import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { APP_LOGO, APP_TITLE } from "@/const";
import { Breadcrumbs } from "@/components/Breadcrumbs";


export default function NewProcess() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [formData, setFormData] = useState({
    name: "",
    object: "",
    estimatedValue: "",
    modality: "",
    category: "",
    platformId: null as number | null,
  });


  // Buscar plataformas disponíveis
  const { data: platforms } = trpc.platforms.list.useQuery();

  const createProcessMutation = trpc.processes.create.useMutation({
    onSuccess: () => {
      toast.success("Processo criado com sucesso!", {
        description: "A geração do ETP será iniciada automaticamente.",
      });
      navigate("/dashboard");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.object || !formData.modality || !formData.category) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    const valueNumber = formData.estimatedValue 
      ? parseFloat(formData.estimatedValue.replace(/[^\d,]/g, "").replace(",", "."))
      : 0;
    
    createProcessMutation.mutate({
      name: formData.name,
      object: formData.object,
      estimatedValue: valueNumber,
      modality: formData.modality,
      category: formData.category,
      platformId: formData.platformId,
    });
  };

  const formatCurrency = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    const formatted = (Number(numbers) / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    return formatted;
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCurrency(e.target.value);
    setFormData({ ...formData, estimatedValue: formatted });
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-gradient-to-r from-card via-card to-primary/5">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/dashboard")}
                className="rounded-full"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <img src={APP_LOGO} alt={APP_TITLE} className="h-12 w-auto" />
              <div>
                <Breadcrumbs items={[
                  { label: "Processos Licitatórios", href: "/processos" },
                  { label: "Novo Processo" }
                ]} className="mb-2" />
                <h1 className="text-xl font-bold text-foreground">Novo Processo Licitatório</h1>
                <p className="text-sm text-muted-foreground">Preencha as informações básicas</p>
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
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Informações do Processo</CardTitle>
            <CardDescription>
              Preencha as informações básicas do processo. O sistema irá gerar automaticamente o ETP
              com base na Lei 14.133/21.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Nome do Processo */}
              <div className="space-y-2">
                <Label htmlFor="name">Nome do Processo *</Label>
                <Input
                  id="name"
                  placeholder="Ex: Aquisição de Material de Escritório"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              {/* Objeto */}
              <div className="space-y-2">
                <Label htmlFor="object">Objeto da Contratação *</Label>
                <Textarea
                  id="object"
                  placeholder="Descreva detalhadamente o objeto da contratação..."
                  value={formData.object}
                  onChange={(e) => setFormData({ ...formData, object: e.target.value })}
                  rows={4}
                  required
                />
              </div>

              {/* Valor Estimado */}
              <div className="space-y-2">
                <Label htmlFor="estimatedValue">Valor Estimado (opcional)</Label>
                <Input
                  id="estimatedValue"
                  placeholder="R$ 0,00"
                  value={formData.estimatedValue}
                  onChange={handleValueChange}
                />
              </div>

              {/* Modalidade e Categoria */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="modality">Modalidade *</Label>
                  <Select
                    value={formData.modality}
                    onValueChange={(value) => setFormData({ ...formData, modality: value })}
                    required
                  >
                    <SelectTrigger id="modality">
                      <SelectValue placeholder="Selecione a modalidade" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pregao">Pregão</SelectItem>
                      <SelectItem value="concorrencia">Concorrência</SelectItem>
                      <SelectItem value="concurso">Concurso</SelectItem>
                      <SelectItem value="leilao">Leilão</SelectItem>
                      <SelectItem value="dialogo_competitivo">Diálogo Competitivo</SelectItem>
                      <SelectItem value="dispensa">Dispensa</SelectItem>
                      <SelectItem value="inexigibilidade">Inexigibilidade</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Categoria *</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value })}
                    required
                  >
                    <SelectTrigger id="category">
                      <SelectValue placeholder="Selecione a categoria" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="obras">Obras</SelectItem>
                      <SelectItem value="servicos">Serviços</SelectItem>
                      <SelectItem value="compras">Compras</SelectItem>
                      <SelectItem value="alienacoes">Alienações</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Plataforma de Pregão */}
              <div className="space-y-2">
                <Label htmlFor="platform">Plataforma de Pregão (opcional)</Label>
                  <Select
                    value={formData.platformId?.toString() || "none"}
                    onValueChange={(value) => setFormData({ ...formData, platformId: value === "none" ? null : parseInt(value) })}
                >
                  <SelectTrigger id="platform">
                    <SelectValue placeholder="Selecione a plataforma" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhuma (formato padrão)</SelectItem>
                    {platforms?.map((platform) => (
                      <SelectItem key={platform.id} value={platform.id.toString()}>
                        {platform.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Selecione a plataforma onde o edital será publicado. O sistema adaptará automaticamente os documentos para os requisitos específicos da plataforma.
                </p>
              </div>

              {/* Botões */}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/dashboard")}
                  disabled={createProcessMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createProcessMutation.isPending}>
                  {createProcessMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar Processo
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
