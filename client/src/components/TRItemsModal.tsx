import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatmatItem } from "@/components/CatmatSearch";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Package, FileSpreadsheet, Search } from "lucide-react";
import ImportItemsModal from "@/components/ImportItemsModal";
import CatmatSuggestionsModal from "@/components/CatmatSuggestionsModal";
import EditItemDialog from "@/components/EditItemDialog";
import { ManualSearchTab } from "@/components/tr-items/ManualSearchTab";
import { ExistingItemsList } from "@/components/tr-items/ExistingItemsList";

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
    id: number; description: string; itemType: "material" | "service";
  } | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedItemForEdit, setSelectedItemForEdit] = useState<any>(null);

  const { data: existingItems, isLoading, refetch } = trpc.processes.getProcessItems.useQuery(
    { processId },
    { enabled: open }
  );

  const saveItemsMutation = trpc.processes.addItemsToTR.useMutation({
    onSuccess: () => {
      toast.success("Itens adicionados com sucesso!");
      setSelectedItems([]);
      refetch();
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (error) => toast.error("Erro ao salvar itens", { description: error.message }),
  });

  const deleteItemMutation = trpc.processes.deleteProcessItem.useMutation({
    onSuccess: () => { toast.success("Item removido com sucesso!"); refetch(); },
    onError: (error) => toast.error("Erro ao remover item", { description: error.message }),
  });

  const handleSave = () => {
    if (selectedItems.length === 0) { toast.error("Adicione pelo menos um item"); return; }
    saveItemsMutation.mutate({
      processId,
      items: selectedItems.map((item) => ({
        itemType: "material" as const,
        catmatCode: item.codigoItem.toString(),
        description: item.descricaoItem,
        unit: item.unidadeFornecimento || item.unidadeMedida || "UN",
        groupCode: item.codigoGrupo?.toString(),
        classCode: item.codigoClasse?.toString(),
      })),
    });
  };

  const handleDelete = (itemId: number) => {
    if (confirm("Tem certeza que deseja remover este item?")) deleteItemMutation.mutate({ itemId });
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
                <Search className="h-4 w-4" />Busca Manual
              </TabsTrigger>
              <TabsTrigger value="import" className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />Importar Planilha
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual">
              <ManualSearchTab
                selectedItems={selectedItems}
                saveIsPending={saveItemsMutation.isPending}
                onSelect={(item) => setSelectedItems([...selectedItems, item])}
                onRemove={(item) => setSelectedItems(selectedItems.filter((i) => i.codigoItem !== item.codigoItem))}
                onSave={handleSave}
                onCancel={() => onOpenChange(false)}
              />
            </TabsContent>

            <TabsContent value="import" className="space-y-6 mt-6">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
                <FileSpreadsheet className="mx-auto h-16 w-16 text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold mb-2">Importar Itens de Planilha</h3>
                <p className="text-sm text-gray-600 mb-6 max-w-md mx-auto">
                  Importe múltiplos itens de uma vez usando arquivos Excel (.xlsx, .xls) ou CSV (.csv).
                  Máximo de 500 itens por importação.
                </p>
                <Button onClick={() => setShowImportModal(true)} size="lg">
                  <FileSpreadsheet className="mr-2 h-5 w-5" />Selecionar Arquivo
                </Button>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">💡 Dica</h4>
                <p className="text-sm text-blue-800">
                  Após importar, você poderá buscar e vincular códigos CATMAT/CATSER correspondentes
                  para cada item importado.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <ExistingItemsList
            items={existingItems ?? []}
            isLoading={isLoading}
            onDelete={handleDelete}
            onEdit={(item) => { setSelectedItemForEdit(item); setShowEditDialog(true); }}
            onSuggest={(item) => { setSelectedItemForSuggestions(item); setShowSuggestionsModal(true); }}
          />
        </DialogContent>
      </Dialog>

      <ImportItemsModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        processId={processId}
        onSuccess={() => { refetch(); setShowImportModal(false); }}
      />

      {selectedItemForSuggestions && (
        <CatmatSuggestionsModal
          open={showSuggestionsModal}
          onClose={() => { setShowSuggestionsModal(false); setSelectedItemForSuggestions(null); }}
          processItemId={selectedItemForSuggestions.id}
          itemDescription={selectedItemForSuggestions.description}
          itemType={selectedItemForSuggestions.itemType}
          onApproved={refetch}
        />
      )}

      {selectedItemForEdit && (
        <EditItemDialog
          open={showEditDialog}
          onClose={() => { setShowEditDialog(false); setSelectedItemForEdit(null); }}
          item={selectedItemForEdit}
          onSuccess={refetch}
        />
      )}
    </>
  );
}
