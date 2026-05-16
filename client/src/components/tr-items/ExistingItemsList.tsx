import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trash2, Sparkles, Pencil } from "lucide-react";

interface ProcessItem {
  id: number;
  catmatCode?: string | number | null;
  catserCode?: string | number | null;
  description: string;
  unit: string;
  quantity?: number | null;
  itemType: string;
}

interface Props {
  items: ProcessItem[];
  isLoading: boolean;
  onDelete: (id: number) => void;
  onEdit: (item: ProcessItem) => void;
  onSuggest: (item: { id: number; description: string; itemType: "material" | "service" }) => void;
}

export function ExistingItemsList({ items, isLoading, onDelete, onEdit, onSuggest }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-2 mt-6 pt-6 border-t">
      <h3 className="text-sm font-medium">Itens Já Adicionados ({items.length})</h3>
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
            {items.map((item, index) => (
              <TableRow key={index}>
                <TableCell className="font-mono text-sm">{item.catmatCode || item.catserCode || "-"}</TableCell>
                <TableCell>{item.description}</TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell>{item.quantity ?? "-"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {!item.catmatCode && !item.catserCode && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => onSuggest({ id: item.id, description: item.description, itemType: item.itemType as "material" | "service" })}
                      >
                        <Sparkles className="h-3 w-3" />
                        Sugerir Código
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => onEdit(item)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(item.id)}>
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
  );
}
