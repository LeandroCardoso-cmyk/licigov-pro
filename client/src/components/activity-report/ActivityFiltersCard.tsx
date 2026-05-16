import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Filter, Search } from "lucide-react";
import { ACTION_LABELS } from "./ActivityLogCard";

interface Props {
  searchQuery: string;
  actionFilter: string;
  dateFrom: string;
  dateTo: string;
  resultCount: number;
  isExportDisabled: boolean;
  onSearchChange: (v: string) => void;
  onActionChange: (v: string) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onClear: () => void;
  onExport: () => void;
}

export function ActivityFiltersCard({
  searchQuery, actionFilter, dateFrom, dateTo, resultCount, isExportDisabled,
  onSearchChange, onActionChange, onDateFromChange, onDateToChange, onClear, onExport,
}: Props) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Filtros
        </CardTitle>
        <CardDescription>Refine sua busca usando os filtros abaixo</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor="search">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Buscar por descrição ou usuário..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="action">Tipo de Ação</Label>
            <Select value={actionFilter} onValueChange={onActionChange}>
              <SelectTrigger id="action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as ações</SelectItem>
                {Object.entries(ACTION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="dateFrom">Data Inicial</Label>
            <Input id="dateFrom" type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="dateTo">Data Final</Label>
            <Input id="dateTo" type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-muted-foreground">
            {resultCount} {resultCount === 1 ? "registro encontrado" : "registros encontrados"}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClear}>Limpar Filtros</Button>
            <Button size="sm" onClick={onExport} disabled={isExportDisabled}>
              <Download className="mr-2 h-4 w-4" />
              Exportar PDF
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
