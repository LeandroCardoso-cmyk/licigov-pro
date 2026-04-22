/**
 * Image generation — Forge API removed.
 * Currently returns a not-implemented error.
 * To re-enable: implement using Gemini Imagen or another provider
 * and update storagePut() calls to use the new server/storage.ts.
 */

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
};

export async function generateImage(
  _options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  throw new Error(
    "Image generation is not yet configured. Set up an image generation provider to enable this feature."
  );
}
