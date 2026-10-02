import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCentsBRL, MONEY_MEANING } from "@/lib/money";

interface Props {
  total: number;
  dispensas: number;
  inexigibilidades: number;
  totalValue: number;
}

export function DirectContractStats({ total, dispensas, inexigibilidades, totalValue }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Total de Contratações</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">{total}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Dispensas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-blue-600">{dispensas}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Inexigibilidades</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-purple-600">{inexigibilidades}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">{MONEY_MEANING.estimated} (total)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {formatCentsBRL(totalValue)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
