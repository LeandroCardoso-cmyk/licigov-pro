import { FileText, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Apostille } from "./types";

const APOSTILLE_LABELS: Record<string, string> = {
  reajuste: "Reajuste",
  correcao: "Correção",
  designacao: "Designação",
  outro: "Outro",
};

const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

interface Props {
  apostilles: Apostille[] | undefined;
  onNewApostille: () => void;
}

export function ContractApostillesTab({ apostilles, onNewApostille }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Apostilamentos</h3>
          <p className="text-sm text-muted-foreground">
            Reajustes, correções e alterações sem modificar a essência do contrato
          </p>
        </div>
        <Button onClick={onNewApostille}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Apostilamento
        </Button>
      </div>

      {apostilles && apostilles.length > 0 ? (
        <div className="space-y-4">
          {apostilles.map((apostille, index) => (
            <Card key={apostille.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Apostilamento #{apostilles.length - index}
                  </CardTitle>
                  <Badge variant="outline">
                    {APOSTILLE_LABELS[apostille.type] ?? apostille.type}
                  </Badge>
                </div>
                <CardDescription>
                  {new Date(apostille.createdAt).toLocaleDateString("pt-BR")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <span className="text-sm text-muted-foreground">Descrição</span>
                  <p className="text-sm">{apostille.description}</p>
                </div>
                {apostille.newTotalValue != null && (
                  <div>
                    <span className="text-sm text-muted-foreground">Novo Valor</span>
                    <p className="font-medium">{brl(apostille.newTotalValue ?? 0)}</p>
                  </div>
                )}
                {apostille.indexType && (
                  <div>
                    <span className="text-sm text-muted-foreground">Índice de Reajuste</span>
                    <p className="font-medium">{apostille.indexType}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum apostilamento registrado</h3>
            <p className="text-muted-foreground mb-4">
              Adicione apostilamentos para registrar reajustes e correções
            </p>
            <Button onClick={onNewApostille}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Apostilamento
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
