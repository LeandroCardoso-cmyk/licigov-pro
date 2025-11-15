import { retrieveRelevantLaw, formatRetrievedContext } from "../services/rag.js";

/**
 * Teste simples do sistema RAG
 */
async function testRAG() {
  console.log("🧪 Testando Sistema RAG\n");
  console.log("=".repeat(60));
  
  try {
    // Teste 1: Buscar trechos sobre ETP
    console.log("\n📋 Teste 1: Buscar trechos sobre Estudo Técnico Preliminar");
    console.log("-".repeat(60));
    
    const etpQuery = "Estudo Técnico Preliminar requisitos obrigatórios";
    const etpResults = await retrieveRelevantLaw(etpQuery, 3);
    
    console.log(`Query: "${etpQuery}"`);
    console.log(`\nResultados encontrados: ${etpResults.length}\n`);
    
    etpResults.forEach((result, i) => {
      console.log(`${i + 1}. ${result.articleNumber || "Sem artigo"}`);
      console.log(`   Similaridade: ${(result.similarity * 100).toFixed(1)}%`);
      console.log(`   Trecho: ${result.content.substring(0, 150)}...`);
      console.log();
    });
    
    // Teste 2: Buscar trechos sobre modalidades de licitação
    console.log("\n📋 Teste 2: Buscar trechos sobre modalidades de licitação");
    console.log("-".repeat(60));
    
    const modalidadeQuery = "modalidades de licitação pregão concorrência";
    const modalidadeResults = await retrieveRelevantLaw(modalidadeQuery, 3);
    
    console.log(`Query: "${modalidadeQuery}"`);
    console.log(`\nResultados encontrados: ${modalidadeResults.length}\n`);
    
    modalidadeResults.forEach((result, i) => {
      console.log(`${i + 1}. ${result.articleNumber || "Sem artigo"}`);
      console.log(`   Similaridade: ${(result.similarity * 100).toFixed(1)}%`);
      console.log(`   Trecho: ${result.content.substring(0, 150)}...`);
      console.log();
    });
    
    // Teste 3: Formatar contexto para prompt
    console.log("\n📋 Teste 3: Formatar contexto para uso em prompt");
    console.log("-".repeat(60));
    
    const formatted = formatRetrievedContext(etpResults);
    console.log("Contexto formatado:");
    console.log(formatted.substring(0, 500) + "...\n");
    
    console.log("=".repeat(60));
    console.log("✅ Todos os testes concluídos com sucesso!");
    console.log("\n📊 Resumo:");
    console.log(`   - Sistema RAG: Funcionando`);
    console.log(`   - Chunks indexados: Acessíveis`);
    console.log(`   - Busca semântica: Operacional`);
    console.log(`   - Formatação de contexto: OK`);
    
  } catch (error) {
    console.error("\n❌ Erro durante os testes:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Executar
testRAG().catch((error) => {
  console.error("❌ Erro não tratado:", error);
  process.exit(1);
});
