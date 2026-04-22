/**
 * Generic external Data API — Forge API removed.
 * This service proxied third-party APIs (e.g., YouTube search) through Manus Forge.
 * To re-enable: call the target APIs directly with their own credentials.
 */

export type DataApiCallOptions = {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};

export async function callDataApi(
  apiId: string,
  _options: DataApiCallOptions = {}
): Promise<unknown> {
  throw new Error(
    `Data API "${apiId}" is not available. The Forge proxy has been removed. Call the target API directly.`
  );
}
