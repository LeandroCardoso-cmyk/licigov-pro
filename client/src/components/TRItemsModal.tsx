import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CatmatSearch, CatmatItem } from "@/components/CatmatSearch";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Trash2, Package, FileSpreadsheet, Search, Sparkles, Pencil } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ImportItemsModal from "@/components/ImportItemsModal";
import CatmatSuggestionsModal from "@/components/CatmatSuggestionsModal";
import EditItemDialog from "@/components/EditItemDialog";
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
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSuggestionsModal, setShowSuggestionsModal] = useState(false);
  const [selectedItemForSuggestions, setSelectedItemForSuggestions] = useState<{
    id: number;
    description: string;
    itemType: "material" | "service";
  } | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedItemForEdit, setSelectedItemForEdit] = useState<any>(null);

  // Buscar itens já adicionados
  const { data: existingItems, isLoading, refetch } = trpc.processes.getProcessItems.useQuery(
    { processId },
    { enabled: open }
  );

  // Mutation para salvar itens
  const saveItemsMutation = trpc.processes.addItemsToTR.useMutation({
    onSuccess: () => {
      toast.success("Itens adicionados com sucesso!");
      setSelectedItems([]);
      refetch();
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Erro ao salvar itens", {
        description: error.message,
      });
    },
  });

  // Mutation para deletar item
  const deleteItemMutation = trpc.processes.deleteProcessItem.useMutation({
    onSuccess: () => {
      toast.success("Item removido com sucesso!");
      refetch();
    },
    onError: (error) => {
      toast.error("Erro ao remover item", {
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

  const handleImportSuccess = () => {
    refetch();
    setShowImportModal(false);
  };

  const handleDeleteItem = (itemId: number) => {
    if (confirm("Tem certeza que deseja remover este item?")) {
      deleteItemMutation.mutate({ itemId });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Adicionar Itens ao Termo de Referência
            </DialogTitle>
            <DialogDescription>
              Busque e selecione itens do catálogo oficial CATMAT/CATSER ou importe de planilha Excel/CSV.
              Conforme a Lei 14.133/21, os itens devem ser especificados nesta etapa.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="manual" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                Busca Manual
              </TabsTrigger>
              <TabsTrigger value="import" className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Importar Planilha
              </TabsTrigger>
            </TabsList>

            {/* Aba de Busca Manual */}
            <TabsContent value="manual" className="space-y-6 mt-6">
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
            </TabsContent>

            {/* Aba de Importação */}
            <TabsContent value="import" className="space-y-6 mt-6">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
                <FileSpreadsheet className="mx-auto h-16 w-16 text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold mb-2">Importar Itens de Planilha</h3>
                <p className="text-sm text-gray-600 mb-6 max-w-md mx-auto">
                  Importe múltiplos itens de uma vez usando arquivos Excel (.xlsx, .xls) ou CSV (.csv).
                  Máximo de 500 itens por importação.
                </p>
                <Button onClick={() => setShowImportModal(true)} size="lg">
                  <FileSpreadsheet className="mr-2 h-5 w-5" />
                  Selecionar Arquivo
                </Button>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">💡 Dica</h4>
                <p className="text-sm text-blue-800">
                  Após importar, você poderá buscar e vincular códigos CATMAT/CATSER correspondentes
                  para cada item importado. A importação facilita a entrada de grandes quantidades de itens.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {/* Itens já salvos (exibido em ambas as abas) */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {existingItems && existingItems.length > 0 && (
            <div className="space-y-2 mt-6 pt-6 border-t">
              <h3 className="text-sm font-medium">Itens Já Adicionados ({existingItems.length})</h3>
              <div className="border rounded-lg bg-muted/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Quantidade</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {existingItems.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono text-sm">{item.catmatCode || item.catserCode || "-"}</TableCell>
                        <TableCell>{item.description}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{item.quantity || "-"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {!item.catmatCode && !item.catserCode && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={() => {
                                  setSelectedItemForSuggestions({
                                    id: item.id,
                                    description: item.description,
                                    itemType: item.itemType as "material" | "service",
                                  });
                                  setShowSuggestionsModal(true);
                                }}
                              >
                                <Sparkles className="h-3 w-3" />
                                Sugerir Código
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedItemForEdit(item);
                                setShowEditDialog(true);
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteItem(item.id)}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de Importação */}
      <ImportItemsModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        processId={processId}
        onSuccess={handleImportSuccess}
      />

      {/* Modal de Sugestões CATMAT */}
      {selectedItemForSuggestions && (
        <CatmatSuggestionsModal
          open={showSuggestionsModal}
          onClose={() => {
            setShowSuggestionsModal(false);
            setSelectedItemForSuggestions(null);
          }}
          processItemId={selectedItemForSuggestions.id}
          itemDescription={selectedItemForSuggestions.description}
          itemType={selectedItemForSuggestions.itemType}
          onApproved={() => {
            refetch();
          }}
        />
      )}

      {/* Modal de Edição de Item */}
      {selectedItemForEdit && (
        <EditItemDialog
          open={showEditDialog}
          onClose={() => {
            setShowEditDialog(false);
            setSelectedItemForEdit(null);
          }}
          item={selectedItemForEdit}
          onSuccess={() => {
            refetch();
          }}
        />
      )}
    </>
  );
}
