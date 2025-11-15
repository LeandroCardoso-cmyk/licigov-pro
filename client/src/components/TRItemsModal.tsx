import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CatmatSearch, CatmatItem } from "@/components/CatmatSearch";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Trash2, Package } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TRItemsModalProps {
  processId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function TRItemsModal({ processId, open, onOpenChange, onSuccess }: TRItemsModalProps) {
  const [selectedItems, setSelectedItems] = useState<CatmatItem[]>([]);

  // Buscar itens já adicionados
  const { data: existingItems, isLoading } = trpc.processes.getProcessItems.useQuery(
    { processId },
    { enabled: open }
  );

  // Mutation para salvar itens
  const saveItemsMutation = trpc.processes.addItemsToTR.useMutation({
    onSuccess: () => {
      toast.success("Itens adicionados com sucesso!");
      setSelectedItems([]);
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Erro ao salvar itens", {
        description: error.message,
      });
    },
  });

  const handleSave = () => {
    if (selectedItems.length === 0) {
      toast.error("Adicione pelo menos um item");
      return;
    }

    saveItemsMutation.mutate({
      processId,
      items: selectedItems.map(item => ({
        itemType: 'material' as const, // TODO: detectar se é material ou serviço
        catmatCode: item.codigoItem.toString(),
        description: item.descricaoItem,
        unit: item.unidadeFornecimento || item.unidadeMedida || 'UN',
        groupCode: item.codigoGrupo?.toString(),
        classCode: item.codigoClasse?.toString(),
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Adicionar Itens ao Termo de Referência
          </DialogTitle>
          <DialogDescription>
            Busque e selecione itens do catálogo oficial CATMAT/CATSER para incluir no TR.
            Conforme a Lei 14.133/21, os itens devem ser especificados nesta etapa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Busca de itens */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Buscar Itens CATMAT/CATSER</h3>
            <CatmatSearch
              type="material"
              onSelect={(item) => {
                // Verificar se já foi adicionado
                if (selectedItems.some(i => i.codigoItem === item.codigoItem)) {
                  toast.error("Item já adicionado");
                  return;
                }
                setSelectedItems([...selectedItems, item]);
              }}
              selectedItems={selectedItems}
              onRemove={(item) => setSelectedItems(selectedItems.filter(i => i.codigoItem !== item.codigoItem))}
            />
          </div>

          {/* Lista de itens selecionados */}
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
                        <TableCell>{item.unidadeFornecimento || item.unidadeMedida || 'UN'}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedItems(selectedItems.filter(i => i.codigoItem !== item.codigoItem))}
                          >
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

          {/* Itens já salvos */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {existingItems && existingItems.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Itens Já Adicionados ({existingItems.length})</h3>
              <div className="border rounded-lg bg-muted/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Unidade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {existingItems.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono text-sm">{item.catmatCode || item.catserCode}</TableCell>
                        <TableCell>{item.description}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Botões */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveItemsMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveItemsMutation.isPending || selectedItems.length === 0}
            >
              {saveItemsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Itens
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
