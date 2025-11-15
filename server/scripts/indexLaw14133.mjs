import { GoogleGenerativeAI } from "@google/generative-ai";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Divide texto em chunks com overlap
 */
function chunkText(text, chunkSize = 512, overlap = 50) {
  const words = text.split(/\s+/);
  const chunks = [];
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }
  }
  
  return chunks;
}

/**
 * Extrai número do artigo de um chunk
 */
function extractArticleNumber(chunk) {
  // Padrões: Art. 1º, Art. 2º-A, Art. 10, etc.
  const match = chunk.match(/Art\.\s*(\d+[ºª]?(-[A-Z])?)/i);
  return match ? match[0] : null;
}

/**
 * Função principal de indexação
 */
async function indexLaw() {
  console.log("🔄 Iniciando indexação da Lei 14.133/21...");
  
  let connection;
  
  try {
    // 1. Conectar ao banco
    connection = await mysql.createConnection(process.env.DATABASE_URL);
    console.log("✅ Conectado ao banco de dados");
    
    // 2. Ler arquivo da lei
    const lawPath = path.join(__dirname, "../../data/lei_14133_2021.txt");
    console.log(`📄 Lendo arquivo: ${lawPath}`);
    
    if (!fs.existsSync(lawPath)) {
      throw new Error(`Arquivo não encontrado: ${lawPath}`);
    }
    
    const lawText = fs.readFileSync(lawPath, "utf-8");
    console.log(`✅ Arquivo lido: ${lawText.length} caracteres`);
    
    // 3. Dividir em chunks
    const chunks = chunkText(lawText, 512, 50);
    console.log(`📄 Lei dividida em ${chunks.length} chunks`);
    
    // 4. Gerar embeddings e salvar no banco
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const articleNumber = extractArticleNumber(chunk);
      
      console.log(`⚙️  Processando chunk ${i + 1}/${chunks.length}... ${articleNumber || "Preâmbulo"}`);
      
      try {
        // Gerar embedding
        const result = await model.embedContent(chunk);
        const embedding = result.embedding.values;
        
        // Salvar no banco
        await connection.execute(
          `INSERT INTO law_chunks (lawName, chunkIndex, articleNumber, content, embedding, metadata, createdAt) 
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [
            "Lei 14.133/21",
            i,
            articleNumber,
            chunk,
            JSON.stringify(embedding),
            JSON.stringify({ 
              section: articleNumber || "Preâmbulo",
              chunkSize: chunk.split(/\s+/).length 
            })
          ]
        );
        
        // Delay para evitar rate limit (100ms entre requisições)
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Erro ao processar chunk ${i + 1}:`, error.message);
        // Continuar mesmo com erro em um chunk
      }
    }
    
    console.log("✅ Indexação concluída com sucesso!");
    console.log(`📊 Total de chunks indexados: ${chunks.length}`);
    
  } catch (error) {
    console.error("❌ Erro fatal na indexação:", error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
  
  process.exit(0);
}

// Executar
indexLaw().catch((error) => {
  console.error("❌ Erro não tratado:", error);
  process.exit(1);
});
