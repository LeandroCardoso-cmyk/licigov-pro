// Helper simples para upload no frontend
// Na prática, você deve fazer upload via backend para segurança
export async function storagePut(key: string, data: Uint8Array, contentType: string) {
  // Por enquanto, retorna URL fake
  // TODO: Implementar upload real via backend
  const url = `https://storage.example.com/${key}`;
  return { url, key };
}
