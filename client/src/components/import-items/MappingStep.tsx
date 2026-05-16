import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DialogFooter } from "@/components/ui/dialog";
import { FileSpreadsheet, Loader2 } from "lucide-react";

export interface ColumnMapping {
  description: number;
  quantity: number | undefined;
  unit: number | undefined;
  unitPrice: number | undefined;
  totalPrice: number | undefined;
}

interface Props {
  file: File | null;
  previewData: any[][];
  columnMapping: ColumnMapping;
  onColumnMappingChange: (mapping: ColumnMapping) => void;
  isParsePending: boolean;
  onParse: () => void;
  onBack: () => void;
}

function ColSelect({
  id, label, value, headers, onChange,
}: { id: string; label: string; value: number | undefined; headers: any[]; onChange: (v: number | undefined) => void }) {
  const required = id === "col-description";
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value !== undefined ? value.toString() : "none"}
        onValueChange={(v) => onChange(v === "none" ? undefined : parseInt(v))}
      >
        <SelectTrigger id={id}><SelectValue placeholder="Nenhuma" /></SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value="none">Nenhuma</SelectItem>}
          {headers.map((header, index) => (
            <SelectItem key={index} value={index.toString()}>
              Coluna {String.fromCharCode(65 + index)} - {header || "(vazia)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function MappingStep({ file, previewData, columnMapping, onColumnMappingChange, isParsePending, onParse, onBack }: Props) {
  const headers = previewData[0] || [];
  const set = (partial: Partial<ColumnMapping>) => onColumnMappingChange({ ...columnMapping, ...partial });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
        <FileSpreadsheet className="h-4 w-4" />
        <span>{file?.name}</span>
        <span className="text-gray-400">•</span>
        <span>{previewData.length - 1} linhas detectadas</span>
      </div>

      <div className="space-y-3">
        <Label>Mapeamento de Colunas</Label>
        <p className="text-sm text-gray-600">Indique qual coluna corresponde a cada informação:</p>
        <div className="grid grid-cols-2 gap-4">
          <ColSelect id="col-description" label="Descrição do Item *" value={columnMapping.description} headers={headers} onChange={(v) => set({ description: v ?? 0 })} />
          <ColSelect id="col-quantity" label="Quantidade (opcional)" value={columnMapping.quantity} headers={headers} onChange={(v) => set({ quantity: v })} />
          <ColSelect id="col-unit" label="Unidade (opcional)" value={columnMapping.unit} headers={headers} onChange={(v) => set({ unit: v })} />
          <ColSelect id="col-unitPrice" label="Valor Unitário (opcional)" value={columnMapping.unitPrice} headers={headers} onChange={(v) => set({ unitPrice: v })} />
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-4 py-2 border-b">
          <p className="text-sm font-medium">Preview (primeiras 5 linhas)</p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((header: any, index: number) => (
                  <TableHead key={index}>{String.fromCharCode(65 + index)} - {header || "(vazia)"}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewData.slice(1).map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell: any, cellIndex: number) => (
                    <TableCell key={cellIndex}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onBack}>Voltar</Button>
        <Button onClick={onParse} disabled={isParsePending}>
          {isParsePending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Analisar Itens
        </Button>
      </DialogFooter>
    </div>
  );
}
