import { drizzle } from "drizzle-orm/mysql2";
import { tasks } from "./drizzle/schema.js";

const db = drizzle(process.env.DATABASE_URL);

const sampleTasks = [
  {
    title: "Revisar Edital de Pregão Eletrônico 001/2024",
    description: "Análise completa do edital antes da publicação, verificar conformidade com Lei 14.133/21",
    type: "Pregão Eletrônico",
    status: "pendente",
    priority: "urgente",
    deadline: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // Amanhã
    assignedTo: 1,
    createdBy: 1,
  },
  {
    title: "Elaborar Termo de Referência para aquisição de notebooks",
    description: "Criar TR detalhado com especificações técnicas e justificativas",
    type: "Elaboração de Documentos",
    status: "em_andamento",
    priority: "alta",
    deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 dias
    assignedTo: 1,
    createdBy: 1,
  },
  {
    title: "Responder impugnação ao Edital 045/2023",
    description: "Preparar resposta técnica e jurídica às impugnações recebidas",
    type: "Análise de Documentação",
    status: "pausada",
    priority: "urgente",
    deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 dias
    assignedTo: 1,
    createdBy: 1,
  },
  {
    title: "Publicar resultado da licitação 038/2023",
    description: "Publicar resultado no portal de transparência e DOU",
    type: "Publicação",
    status: "aguardando_informacao",
    priority: "media",
    deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 dias
    assignedTo: 1,
    createdBy: 1,
  },
  {
    title: "Atualizar cadastro de fornecedores",
    description: "Revisar e atualizar cadastro de fornecedores no sistema",
    type: "Cadastro",
    status: "atrasada",
    priority: "baixa",
    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
    assignedTo: 1,
    createdBy: 1,
  },
  {
    title: "Arquivar processo licitatório 012/2023",
    description: "Organizar documentação e arquivar processo finalizado",
    type: "Arquivo",
    status: "concluida",
    priority: "baixa",
    deadline: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // Vencido há 5 dias
    assignedTo: 1,
    createdBy: 1,
  },
  {
    title: "Solicitar parecer jurídico para contratação emergencial",
    description: "Encaminhar processo para análise jurídica urgente",
    type: "Parecer Jurídico",
    status: "pendente",
    priority: "urgente",
    deadline: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Vencido ontem
    assignedTo: 1,
    createdBy: 1,
  },
  {
    title: "Preparar relatório mensal de licitações",
    description: "Compilar dados estatísticos do mês para relatório gerencial",
    type: "Relatório",
    status: "em_andamento",
    priority: "media",
    deadline: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 dias
    assignedTo: 1,
    createdBy: 1,
  },
];

async function seed() {
  console.log("🌱 Inserindo tarefas de teste...");
  
  for (const task of sampleTasks) {
    await db.insert(tasks).values(task);
    console.log(`✅ Tarefa criada: ${task.title}`);
  }
  
  console.log("✨ Seed concluído com sucesso!");
  process.exit(0);
}

seed().catch((error) => {
  console.error("❌ Erro ao inserir tarefas:", error);
  process.exit(1);
});
