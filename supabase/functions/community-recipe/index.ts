import { cleanText, handleOptions, json, PublicError, publicErrorResponse } from '../_shared/core.ts';
import { enqueueEmail } from '../_shared/email.ts';
import {
  adminClient,
  normalizeEmail,
  notifyAdmins,
  removeImages,
  uploadImage,
  validateImage,
} from '../_shared/community.ts';

function multiline(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? '')
    .trim()
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLength);
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const form = await req.formData();
    // Campo invisível preenchido por robôs comuns.
    if (cleanText(form.get('website'), 200)) return json({ ok: true });

    const authorName = cleanText(form.get('author_name'), 120);
    const email = normalizeEmail(form.get('email'));
    const title = cleanText(form.get('title'), 140);
    const introduction = multiline(form.get('introduction'), 500);
    const ingredients = multiline(form.get('ingredients'), 4000);
    const instructions = multiline(form.get('instructions'), 8000);
    const prepRaw = Number(form.get('prep_minutes') || 0);
    const prepMinutes = Number.isInteger(prepRaw) && prepRaw > 0 ? prepRaw : null;
    const servings = cleanText(form.get('servings'), 80) || null;
    if (authorName.length < 2) throw new PublicError('Informe seu nome.');
    if (title.length < 3) throw new PublicError('Informe o nome da receita.');
    if (ingredients.length < 5) throw new PublicError('Informe os ingredientes da receita.');
    if (instructions.length < 10) throw new PublicError('Explique o modo de preparo.');
    if (prepMinutes && prepMinutes > 1440) throw new PublicError('O tempo de preparo deve ser de até 1.440 minutos.');

    const admin = adminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [recent, globalVolume] = await Promise.all([
      admin.from('recipe_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('email', email)
        .gte('created_at', since),
      admin.from('recipe_submissions')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceHour),
    ]);
    if (recent.error) throw recent.error;
    if (globalVolume.error) throw globalVolume.error;
    if ((recent.count || 0) >= 3) throw new PublicError('Você já enviou 3 receitas nas últimas 24 horas. Tente novamente amanhã.', 429);
    if ((globalVolume.count || 0) >= 30) throw new PublicError('Recebemos muitas receitas agora. Tente novamente em uma hora.', 429);

    const customer = await admin.from('customers').select('id').ilike('email', email).order('active', { ascending: false }).limit(1);
    if (customer.error) throw customer.error;

    const recipeId = crypto.randomUUID();
    const fileValue = form.get('photo');
    const file = fileValue instanceof File ? validateImage(fileValue) : null;
    let imagePath: string | null = null;
    try {
      if (file) imagePath = await uploadImage(file, `recipes/${recipeId}`);
      const inserted = await admin.from('recipe_submissions').insert({
        id: recipeId,
        customer_id: customer.data?.[0]?.id || null,
        author_name: authorName,
        email,
        title,
        introduction: introduction || null,
        ingredients,
        instructions,
        prep_minutes: prepMinutes,
        servings,
        image_path: imagePath,
        status: 'pending',
      });
      if (inserted.error) throw inserted.error;
    } catch (error) {
      await removeImages([imagePath]);
      console.error('Recipe submission failed', error);
      if (error instanceof PublicError) throw error;
      throw new PublicError('Não foi possível salvar sua receita. Tente novamente.', 500);
    }

    try {
      await enqueueEmail({
        category: 'transactional',
        templateKey: 'recipe_received',
        recipientEmail: email,
        recipientName: authorName,
        senderKind: 'customer',
        subject: 'Recebemos sua receita para o Itajaó',
        payload: { customer_name: authorName, recipe_title: title },
        idempotencyKey: `recipe:${recipeId}:received`,
        relatedCustomerId: customer.data?.[0]?.id || null,
        resourceType: 'recipe',
        resourceId: recipeId,
        priority: 55,
      });
    } catch (error) {
      console.error('Recipe receipt email queue failed', error);
    }

    try {
      await notifyAdmins({
        kind: 'recipe_received',
        title: 'Nova receita recebida',
        message: `${authorName} enviou a receita “${title}” para análise.`,
        eventKey: `recipe-submission:${recipeId}`,
        metadata: { recipe_id: recipeId },
        templateKey: 'admin_recipe_received',
        resourceType: 'recipe',
        resourceId: recipeId,
      });
    } catch (error) {
      console.error('Recipe admin notification failed', error);
    }

    return json({ ok: true });
  } catch (error) {
    return publicErrorResponse(error);
  }
});
