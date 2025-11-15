import mysql from 'mysql2/promise';

async function checkEmbeddingFormat() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  const [rows] = await conn.execute('SELECT id, lawName, embedding FROM law_chunks LIMIT 1') as any;
  
  console.log('ID:', rows[0].id);
  console.log('Law:', rows[0].lawName);
  console.log('Embedding type:', typeof rows[0].embedding);
  console.log('Embedding preview (first 200 chars):', JSON.stringify(rows[0].embedding).substring(0, 200));
  
  // Tentar parsear
  try {
    if (typeof rows[0].embedding === 'string') {
      const parsed = JSON.parse(rows[0].embedding);
      console.log('✅ Embedding é string JSON válida');
      console.log('Array length:', parsed.length);
    } else if (Array.isArray(rows[0].embedding)) {
      console.log('✅ Embedding já é array');
      console.log('Array length:', rows[0].embedding.length);
    } else {
      console.log('❌ Embedding tem tipo inesperado:', rows[0].embedding);
    }
  } catch (error) {
    console.log('❌ Erro ao parsear embedding:', error);
  }
  
  await conn.end();
}

checkEmbeddingFormat().catch(console.error);
