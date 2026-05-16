import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, Star } from "lucide-react";

const DOC_TYPE_LABELS: Record<string, string> = {
  etp: "ETP (Estudo Técnico Preliminar)",
  tr: "TR (Termo de Referência)",
  dfd: "DFD (Documento de Formalização de Demanda)",
  edital: "Edital",
};

interface Template {
  id: number;
  name: string;
  description?: string | null;
  type: string;
  isDefault: number | boolean;
  createdAt: Date | string;
}

interface Props {
  template: Template;
  onEdit: (template: Template) => void;
  onDelete: (id: number) => void;
  onToggleDefault: (template: Template) => void;
}

export function TemplateCard({ template, onEdit, onDelete, onToggleDefault }: Props) {
  const isDefault = template.isDefault === 1 || template.isDefault === true;

  return (
    <Card className="relative">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              {template.name}
              {isDefault && <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />}
            </CardTitle>
            <CardDescription className="mt-1">{template.description || "Sem descrição"}</CardDescription>
          </div>
        </div>
        <Badge variant="secondary" className="mt-2 w-fit">
          {DOC_TYPE_LABELS[template.type] ?? template.type}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Criado em {new Date(template.createdAt).toLocaleDateString("pt-BR")}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onToggleDefault(template)} title={isDefault ? "Remover como padrão" : "Definir como padrão"}>
              <Star className={`h-4 w-4 ${isDefault ? "fill-yellow-400 text-yellow-400" : ""}`} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onEdit(template)}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete(template.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
