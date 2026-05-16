import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const OPERATION_LABELS: Record<string, string> = {
  embedding: "Embeddings",
  rag_query: "Consultas RAG",
  catmat_matching: "Matching CATMAT",
  document_generation: "Geração de Documentos",
};

interface AIRecord {
  id: number;
  createdAt: Date | string;
  operationType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: string | number;
}

interface Props {
  history: AIRecord[] | undefined;
  isLoading: boolean;
}

export function AIHistoryTable({ history, isLoading }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de Operações</CardTitle>
        <CardDescription>Últimas 50 operações de IA</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data/Hora</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead className="text-right">Tokens Entrada</TableHead>
                <TableHead className="text-right">Tokens Saída</TableHead>
                <TableHead className="text-right">Custo (USD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando histórico...</TableCell>
                </TableRow>
              ) : history && history.length > 0 ? (
                history.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono text-sm">{new Date(record.createdAt).toLocaleString("pt-BR")}</TableCell>
                    <TableCell>{OPERATION_LABELS[record.operationType] ?? record.operationType}</TableCell>
                    <TableCell className="font-mono text-sm">{record.model}</TableCell>
                    <TableCell className="text-right">{record.inputTokens.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{record.outputTokens.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">US$ {parseFloat(String(record.estimatedCostUSD)).toFixed(6)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma operação registrada no período</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
