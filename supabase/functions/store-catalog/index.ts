import { handleOptions, json, publicErrorResponse } from '../_shared/core.ts';
import { loadCatalog, publicCatalog } from '../_shared/catalog.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'GET') return json({ error: 'Método não permitido.' }, 405);
  try {
    const catalog = await loadCatalog();
    return json(
      { products: publicCatalog(catalog), updatedAt: new Date().toISOString() },
      200,
      { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' },
    );
  } catch (error) {
    return publicErrorResponse(error);
  }
});
