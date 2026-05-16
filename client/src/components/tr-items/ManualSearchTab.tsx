import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trash2 } from "lucide-react";
import { CatmatSearch, CatmatItem } from "@/components/CatmatSearch";
import { toast } from "sonner";

interface Props {
  selectedItems: CatmatItem[];
  saveIsPending: boolean;
  onSelect: (item: CatmatItem) => void;
  onRemove: (item: CatmatItem) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ManualSearchTab({ selectedItems, saveIsPending, onSelect, onRemove, onSave, onCancel }: Props) {
  const handleSelect = (item: CatmatItem) => {
    if (selectedItems.some((i) => i.codigoItem === item.codigoItem)) {
      toast.error("Item já adicionado");
      return;
    }
    onSelect(item);
  };

  return (
    <div className="space-y-6 mt-6">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Buscar Itens CATMAT/CATSER</h3>
        <CatmatSearch
          type="material"
          onSelect={handleSelect}
          selectedItems={selectedItems}
          onRemove={onRemove}
        />
      </div>

      {selectedItems.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Itens Selecionados ({selectedItems.length})</h3>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedItems.map((item) => (
                  <TableRow key={item.codigoItem}>
                    <TableCell className="font-mono text-sm">{item.codigoItem}</TableCell>
                    <TableCell>{item.descricaoItem}</TableCell>
                    <TableCell>{item.unidadeFornecimento || item.unidadeMedida || "UN"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => onRemove(item)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onCancel} disabled={saveIsPending}>Cancelar</Button>
        <Button onClick={onSave} disabled={saveIsPending || selectedItems.length === 0}>
          {saveIsPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar Itens
        </Button>
      </div>
    </div>
  );
}
