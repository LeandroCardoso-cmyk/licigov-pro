import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface Props {
  parsedItems: any[];
  isAddPending: boolean;
  onImport: () => void;
  onBack: () => void;
}

export function ReviewStep({ parsedItems, isAddPending, onImport, onBack }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <div>
          <p className="font-medium text-green-900">{parsedItems.length} itens prontos para importar</p>
          <p className="text-sm text-green-700">Revise os itens abaixo antes de importar</p>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-24">Qtd</TableHead>
              <TableHead className="w-24">Unidade</TableHead>
              <TableHead className="w-32">Valor Unit.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parsedItems.map((item, index) => (
              <TableRow key={index}>
                <TableCell>{index + 1}</TableCell>
                <TableCell className="font-medium">{item.description}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell>{item.unitPrice > 0 ? `R$ ${item.unitPrice.toFixed(2)}` : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-start gap-2 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
        <div className="text-sm text-blue-900">
          <p className="font-medium mb-1">Atenção:</p>
          <p>
            Os itens serão importados como "Material". Você poderá ajustar o tipo e buscar códigos
            CATMAT/CATSER correspondentes após a importação.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onBack}>Voltar</Button>
        <Button onClick={onImport} disabled={isAddPending}>
          {isAddPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Importar {parsedItems.length} Itens
        </Button>
      </DialogFooter>
    </div>
  );
}
