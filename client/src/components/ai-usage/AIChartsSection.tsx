import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

interface LineItem { date: string; custo: number; operacoes: number }
interface PieItem { name: string; value: number; count: number }

interface Props {
  lineChartData: LineItem[];
  pieChartData: PieItem[];
}

export function AIChartsSection({ lineChartData, pieChartData }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Evolução de Custos</CardTitle>
          <CardDescription>Custo diário em USD</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={lineChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip
                formatter={(value: any, name: string) => {
                  if (name === "custo") return [`US$ ${value}`, "Custo"];
                  return [value, "Operações"];
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="custo" stroke="#3b82f6" strokeWidth={2} name="Custo (USD)" />
              <Line type="monotone" dataKey="operacoes" stroke="#10b981" strokeWidth={2} name="Operações" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Distribuição por Tipo</CardTitle>
          <CardDescription>Custo por tipo de operação</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieChartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.name}: US$ ${entry.value.toFixed(4)}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {pieChartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: any) => `US$ ${value.toFixed(4)}`} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
