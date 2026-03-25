import { retrieveRelevantLaw } from '../services/rag';

async function testRAG() {
  console.log('🧪 Testando Sistema RAG\n');
  console.log('='.repeat(60));
  
  // Teste 1: Buscar sobre pesquisa de preços
  console.log('\n📋 Teste 1: Pesquisa de Preços');
  console.log('-'.repeat(60));
  const test1 = await retrieveRelevantLaw(
    'procedimento de pesquisa de preços para licitação',
    5
  );
  console.log(`✅ Encontrados ${test1.length} trechos relevantes:`);
  test1.forEach((chunk, i) => {
    console.log(`\n${i + 1}. Documento: ${chunk.articleNumber}`);
    console.log(`   Similaridade: ${(chunk.similarity * 100).toFixed(1)}%`);
    console.log(`   Trecho: ${chunk.content.substring(0, 150)}...`);
  });
  
  // Teste 2: Buscar sobre microempresas
  console.log('\n\n📋 Teste 2: Tratamento de Microempresas');
  console.log('-'.repeat(60));
  const test2 = await retrieveRelevantLaw(
    'tratamento diferenciado para microempresas e empresas de pequeno porte',
    5
  );
  console.log(`✅ Encontrados ${test2.length} trechos relevantes:`);
  test2.forEach((chunk, i) => {
    console.log(`\n${i + 1}. Documento: ${chunk.articleNumber}`);
    console.log(`   Similaridade: ${(chunk.similarity * 100).toFixed(1)}%`);
    console.log(`   Trecho: ${chunk.content.substring(0, 150)}...`);
  });
  
  // Teste 3: Buscar sobre dispensa de licitação
  console.log('\n\n📋 Teste 3: Dispensa de Licitação');
  console.log('-'.repeat(60));
  const test3 = await retrieveRelevantLaw(
    'hipóteses de dispensa de licitação',
    5
  );
  console.log(`✅ Encontrados ${test3.length} trechos relevantes:`);
  test3.forEach((chunk, i) => {
    console.log(`\n${i + 1}. Documento: ${chunk.articleNumber}`);
    console.log(`   Similaridade: ${(chunk.similarity * 100).toFixed(1)}%`);
    console.log(`   Trecho: ${chunk.content.substring(0, 150)}...`);
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Testes concluídos com sucesso!');
  console.log('='.repeat(60));
  
  process.exit(0);
}

testRAG().catch(error => {
  console.error('❌ Erro ao testar RAG:', error);
  process.exit(1);
});
