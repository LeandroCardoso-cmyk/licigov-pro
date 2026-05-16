import { useState } from "react";
import { Plus, DollarSign, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function QuotationsTab({ contractId }: { contractId: number }) {
  const [showDialog, setShowDialog] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [value, setValue] = useState("");
  const [date, setDate] = useState("");

  const { data: quotations } = trpc.directContracts.quotations.list.useQuery({ directContractId: contractId });
  const utils = trpc.useUtils();
  const addMutation = (trpc as any).directContracts.quotations.add.useMutation();
  const deleteMutation = (trpc as any).directContracts.quotations.delete.useMutation();

  const invalidate = () => utils.directContracts.quotations.list.invalidate({ directContractId: contractId });

  const handleAdd = async () => {
    if (!supplier || !value || !date) {
      toast.error("Preencha todos os campos");
      return;
    }
    try {
      await addMutation.mutateAsync({
        directContractId: contractId,
        supplierName: supplier,
        value: parseFloat(value) * 100,
      });
      toast.success("Cotação adicionada!");
      setShowDialog(false);
      setSupplier("");
      setValue("");
      setDate("");
      invalidate();
    } catch (error: any) {
      toast.error(error.message || "Erro ao adicionar cotação");
    }
  };

  const handleDelete = async (quotationId: number) => {
    if (!confirm("Deseja realmente excluir esta cotação?")) return;
    try {
      await deleteMutation.mutateAsync({ id: quotationId });
      toast.success("Cotação excluída!");
      invalidate();
    } catch (error: any) {
      toast.error(error.message || "Erro ao excluir cotação");
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Cotações de Preços</CardTitle>
              <CardDescription>Registre as cotações recebidas para comparação</CardDescription>
            </div>
            <Button onClick={() => setShowDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Cotação
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {quotations && quotations.length > 0 ? (
            <div className="space-y-2">
              {quotations.map((quotation) => (
                <div
                  key={quotation.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <DollarSign className="w-5 h-5 text-green-600" />
                    <div>
                      <p className="font-medium">{quotation.supplierName}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {format(new Date(quotation.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xl font-bold text-green-600">
                      R$ {(quotation.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(quotation.id)}>
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-600 dark:text-gray-400 py-8">
              Nenhuma cotação registrada ainda
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Cotação</DialogTitle>
            <DialogDescription>Registre uma nova cotação de preços</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="supplier">Fornecedor *</Label>
              <Input
                id="supplier"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="Nome do fornecedor"
              />
            </div>
            <div>
              <Label htmlFor="value">Valor (R$) *</Label>
              <Input
                id="value"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Ex: 15000.00"
                step="0.01"
              />
            </div>
            <div>
              <Label htmlFor="date">Data da Cotação *</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAdd} disabled={addMutation.isPending}>
                {addMutation.isPending ? "Adicionando..." : "Adicionar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
