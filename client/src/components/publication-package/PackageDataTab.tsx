import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy } from "lucide-react";

interface Process {
  name: string;
  object: string | null;
  estimatedValue?: number | null;
  modality?: string | null;
  category?: string | null;
}

interface Settings {
  organizationName?: string | null;
  cnpj?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

interface Props {
  process: Process;
  settings: Settings;
  onCopyField: (text: string, fieldName: string) => void;
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{value}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onCopy}>
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function PackageDataTab({ process, settings, onCopyField }: Props) {
  const processFields = [
    { label: "Nome do Processo", value: process.name },
    { label: "Objeto", value: process.object ?? "" },
    {
      label: "Valor Estimado",
      value: process.estimatedValue
        ? `R$ ${(process.estimatedValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
        : "Não informado",
    },
    { label: "Modalidade", value: process.modality ?? "" },
    { label: "Categoria", value: process.category ?? "" },
  ];

  const orgFields = [
    { label: "Nome da Organização", value: settings.organizationName },
    { label: "CNPJ", value: settings.cnpj },
    { label: "Endereço", value: settings.address },
    { label: "Telefone", value: settings.phone },
    { label: "E-mail", value: settings.email },
    { label: "Website", value: settings.website },
  ].filter((f): f is { label: string; value: string } => !!f.value);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Dados do Processo</CardTitle>
          <CardDescription>Copie os dados para preencher campos na plataforma</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {processFields.map((field) => (
            <CopyRow key={field.label} label={field.label} value={field.value} onCopy={() => onCopyField(field.value, field.label)} />
          ))}
        </CardContent>
      </Card>

      {settings.organizationName && (
        <Card>
          <CardHeader><CardTitle>Dados da Organização</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {orgFields.map((field) => (
              <CopyRow key={field.label} label={field.label} value={field.value} onCopy={() => onCopyField(field.value, field.label)} />
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
