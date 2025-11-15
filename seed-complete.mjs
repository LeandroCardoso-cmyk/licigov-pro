import { drizzle } from "drizzle-orm/mysql2";
import { users, subscriptionPlans, subscriptions, invoiceInstallments, contractRenewals } from "./drizzle/schema.js";

const db = drizzle(process.env.DATABASE_URL);

async function seed() {
  console.log("🌱 Iniciando seed completo de dados de teste...\n");

  try {
    // 1. Criar planos de assinatura
    console.log("📦 Criando planos de assinatura...");
    const plansData = [
      {
        name: "Basic",
        slug: "basic",
        description: "Plano básico para pequenos órgãos",
        price: 29900, // R$ 299,00
        isActive: true,
      },
      {
        name: "Professional",
        slug: "professional",
        description: "Plano profissional para órgãos médios",
        price: 59900, // R$ 599,00
        isActive: true,
      },
      {
        name: "Enterprise",
        slug: "enterprise",
        description: "Plano empresarial para grandes órgãos",
        price: 119900, // R$ 1.199,00
        isActive: true,
      },
    ];

    for (const plan of plansData) {
      await db.insert(subscriptionPlans).values(plan).onDuplicateKeyUpdate({ set: { name: plan.name } });
    }
    console.log("✅ Planos criados\n");

    // 2. Criar usuários de teste (órgãos públicos)
    console.log("📝 Criando usuários de teste...");
    const testUsers = [
      {
        openId: "test-user-prefsp",
        name: "Prefeitura Municipal de São Paulo",
        email: "licitacao@prefsp.gov.br",
        loginMethod: "email",
        role: "user",
      },
      {
        openId: "test-user-saude",
        name: "Secretaria de Saúde do Estado",
        email: "compras@saude.sp.gov.br",
        loginMethod: "email",
        role: "user",
      },
      {
        openId: "test-user-tj",
        name: "Tribunal de Justiça",
        email: "contratos@tjsp.jus.br",
        loginMethod: "email",
        role: "user",
      },
      {
        openId: "test-user-camara",
        name: "Câmara Municipal",
        email: "administrativo@camara.sp.gov.br",
        loginMethod: "email",
        role: "user",
      },
    ];

    for (const user of testUsers) {
      await db.insert(users).values(user).onDuplicateKeyUpdate({ set: { name: user.name } });
    }
    console.log("✅ Usuários criados\n");

    // 3. Buscar IDs dos usuários e planos
    const allUsers = await db.select().from(users);
    const allPlans = await db.select().from(subscriptionPlans);

    const testUsersList = allUsers.filter(u => u.openId?.startsWith("test-user-"));
    
    if (testUsersList.length === 0) {
      throw new Error("Usuários de teste não encontrados");
    }

    if (allPlans.length === 0) {
      throw new Error("Planos não encontrados");
    }

    const professionalPlan = allPlans.find(p => p.name === "Professional");
    const enterprisePlan = allPlans.find(p => p.name === "Enterprise");

    if (!professionalPlan || !enterprisePlan) {
      throw new Error("Planos Professional ou Enterprise não encontrados");
    }

    console.log(`📊 Encontrados ${testUsersList.length} usuários de teste e ${allPlans.length} planos\n`);

    // 4. Criar assinaturas via empenho com diferentes status
    console.log("💼 Criando assinaturas via empenho...");
    
    const now = new Date();
    const subscriptionsData = [
      {
        userId: testUsersList[0].id,
        planId: professionalPlan.id,
        status: "active",
        currentPeriodStart: new Date(now.getFullYear() - 1, now.getMonth(), 1),
        currentPeriodEnd: new Date(now.getFullYear(), now.getMonth(), 0),
        numeroEmpenho: "2023NE000123",
        valorEmpenho: professionalPlan.price * 12,
        renewalCount: 3,
        originalStartDate: new Date(now.getFullYear() - 3, now.getMonth(), 1),
        lastRenewalDate: new Date(now.getFullYear() - 1, now.getMonth(), 1),
      },
      {
        userId: testUsersList[1].id,
        planId: enterprisePlan.id,
        status: "active",
        currentPeriodStart: new Date(now.getFullYear(), 0, 1),
        currentPeriodEnd: new Date(now.getFullYear(), 11, 31),
        numeroEmpenho: "2024NE000456",
        valorEmpenho: enterprisePlan.price * 12,
        renewalCount: 8,
        originalStartDate: new Date(now.getFullYear() - 8, 0, 1),
        lastRenewalDate: new Date(now.getFullYear(), 0, 1),
      },
      {
        userId: testUsersList[2].id,
        planId: professionalPlan.id,
        status: "active",
        currentPeriodStart: new Date(now.getFullYear(), now.getMonth() - 6, 1),
        currentPeriodEnd: new Date(now.getFullYear() + 1, now.getMonth() - 6, 0),
        numeroEmpenho: "2024NE000789",
        valorEmpenho: professionalPlan.price * 12,
        renewalCount: 0,
        originalStartDate: new Date(now.getFullYear(), now.getMonth() - 6, 1),
      },
      {
        userId: testUsersList[3].id,
        planId: enterprisePlan.id,
        status: "active",
        currentPeriodStart: new Date(now.getFullYear() - 1, now.getMonth(), 15),
        currentPeriodEnd: new Date(now.getFullYear(), now.getMonth(), 14),
        numeroEmpenho: "2023NE001012",
        valorEmpenho: enterprisePlan.price * 12,
        renewalCount: 7,
        originalStartDate: new Date(now.getFullYear() - 7, now.getMonth(), 15),
        lastRenewalDate: new Date(now.getFullYear() - 1, now.getMonth(), 15),
      },
    ];

    const createdSubscriptions = [];
    for (const sub of subscriptionsData) {
      const result = await db.insert(subscriptions).values(sub);
      createdSubscriptions.push({ ...sub, id: Number(result[0].insertId) });
    }
    console.log("✅ Assinaturas criadas\n");

    // 5. Criar parcelas mensais para cada assinatura
    console.log("📅 Criando parcelas mensais...");
    
    for (const sub of createdSubscriptions) {
      const plan = allPlans.find(p => p.id === sub.planId);
      const startDate = new Date(sub.currentPeriodStart);
      
      for (let i = 0; i < 12; i++) {
        const referenceMonth = (startDate.getMonth() + i) % 12 + 1;
        const referenceYear = startDate.getFullYear() + Math.floor((startDate.getMonth() + i) / 12);
        const dueDate = new Date(referenceYear, referenceMonth - 1, 10);
        
        // Determinar status baseado na data
        let status = "pendente";
        let numeroNF = null;
        let dataEmissao = null;
        let dataPagamento = null;
        
        if (dueDate < now) {
          // Parcelas passadas
          if (Math.random() > 0.2) {
            // 80% foram pagas
            status = "paga";
            numeroNF = `NF-${referenceYear}-${String(referenceMonth).padStart(2, "0")}-${Math.floor(Math.random() * 9000) + 1000}`;
            dataEmissao = new Date(referenceYear, referenceMonth - 1, 5);
            dataPagamento = new Date(referenceYear, referenceMonth - 1, Math.floor(Math.random() * 5) + 8);
          } else if (Math.random() > 0.5) {
            // 10% foram emitidas mas não pagas (atrasadas)
            status = "emitida";
            numeroNF = `NF-${referenceYear}-${String(referenceMonth).padStart(2, "0")}-${Math.floor(Math.random() * 9000) + 1000}`;
            dataEmissao = new Date(referenceYear, referenceMonth - 1, 5);
          }
          // 10% ficam pendentes (atrasadas sem NF)
        } else if (referenceMonth === now.getMonth() + 1 && referenceYear === now.getFullYear()) {
          // Mês atual - algumas já emitidas
          if (Math.random() > 0.5) {
            status = "emitida";
            numeroNF = `NF-${referenceYear}-${String(referenceMonth).padStart(2, "0")}-${Math.floor(Math.random() * 9000) + 1000}`;
            dataEmissao = new Date(referenceYear, referenceMonth - 1, 5);
          }
        }
        
        await db.insert(invoiceInstallments).values({
          subscriptionId: sub.id,
          mesReferencia: referenceMonth,
          anoReferencia: referenceYear,
          valor: plan.price,
          dataVencimento: dueDate,
          status,
          numeroNF,
          dataEmissao,
          dataPagamento,
        });
      }
    }
    console.log("✅ Parcelas criadas\n");

    // 6. Criar histórico de renovações para contratos com renewalCount > 0
    console.log("🔄 Criando histórico de renovações...");
    
    const adminUser = allUsers.find(u => u.role === "admin");
    const renewedBy = adminUser ? adminUser.id : 1;
    
    for (const sub of createdSubscriptions) {
      if (sub.renewalCount > 0) {
        const startDate = new Date(sub.originalStartDate);
        
        for (let i = 1; i <= sub.renewalCount; i++) {
          const previousEndDate = new Date(startDate.getFullYear() + i - 1, startDate.getMonth() + 12, 0);
          const newEndDate = new Date(startDate.getFullYear() + i, startDate.getMonth() + 12, 0);
          
          await db.insert(contractRenewals).values({
            subscriptionId: sub.id,
            renewalNumber: i,
            previousEndDate,
            newEndDate,
            numeroEmpenho: `${sub.numeroEmpenho.slice(0, 4)}NE00${1000 + i}`,
            valorRenovacao: sub.valorEmpenho,
            observacoes: i === sub.renewalCount 
              ? "Renovação mais recente" 
              : `Renovação ${i} de ${sub.renewalCount}`,
            renewedBy,
          });
        }
      }
    }
    console.log("✅ Histórico de renovações criado\n");

    console.log("🎉 Seed concluído com sucesso!\n");
    console.log("📊 Resumo:");
    console.log(`   - ${plansData.length} planos de assinatura`);
    console.log(`   - ${testUsers.length} usuários (órgãos públicos)`);
    console.log(`   - ${createdSubscriptions.length} assinaturas via empenho`);
    console.log(`   - ${createdSubscriptions.length * 12} parcelas mensais`);
    console.log(`   - Histórico de renovações para contratos antigos`);
    console.log("\n✨ Você pode agora testar todos os dashboards!");
    console.log("\n🔗 Acesse: https://3000-ile9mkcyougausci23phd-7c1b520e.manusvm.computer");
    
  } catch (error) {
    console.error("❌ Erro ao popular banco:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

seed();
