import mysql from 'mysql2/promise';

async function clearChunks() {
  console.log('🗑️  Limpando chunks antigos do banco de dados...\n');
  
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  
  try {
    const [result]: any = await connection.execute('DELETE FROM law_chunks');
    console.log(`✅ ${result.affectedRows} chunks deletados com sucesso!`);
  } catch (error) {
    console.error('❌ Erro ao deletar chunks:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

clearChunks().catch(console.error);
