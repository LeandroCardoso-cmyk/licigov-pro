import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const COLORS = {
  dispensa: "#3b82f6",
  inexigibilidade: "#8b5cf6",
};

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];

interface MonthlyChartItem {
  month: string;
  monthLabel: string;
  dispensa: number;
  inexigibilidade: number;
}

interface PlatformItem {
  name: string;
  value: number;
  count: number;
}

interface StatusItem {
  name: string;
  value: number;
}

interface Props {
  monthlyChartData: MonthlyChartItem[];
  platformData: PlatformItem[];
  statusData: StatusItem[];
}

export function ChartsSection({ monthlyChartData, platformData, statusData }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Dispensas vs Inexigibilidades</CardTitle>
          <CardDescription>Evolução mensal nos últimos 12 meses</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="monthLabel" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="dispensa" name="Dispensas" stroke={COLORS.dispensa} strokeWidth={2} />
              <Line type="monotone" dataKey="inexigibilidade" name="Inexigibilidades" stroke={COLORS.inexigibilidade} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Valor Total por Plataforma</CardTitle>
          <CardDescription>Distribuição de valores contratados</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={platformData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip
                formatter={(value: number) =>
                  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)
                }
              />
              <Legend />
              <Bar dataKey="value" name="Valor Total" fill={COLORS.dispensa} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Distribuição por Status</CardTitle>
          <CardDescription>Status atual das contratações</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={statusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.name}: ${entry.value}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {statusData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evolução Mensal</CardTitle>
          <CardDescription>Total de contratações por mês</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart
              data={monthlyChartData.map((item) => ({ ...item, total: item.dispensa + item.inexigibilidade }))}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="monthLabel" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="total" name="Total" stroke={COLORS.dispensa} fill={COLORS.dispensa} fillOpacity={0.6} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
