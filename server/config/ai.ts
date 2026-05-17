export const AI_CONFIG = {
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  /** True quando a chave Gemini está presente e não-vazia */
  isConfigured: !!(process.env.GEMINI_API_KEY?.trim()),
};
