import type { Q } from '../db.js';
import type { AuthUser } from '../auth.js';

export async function audit(q: Q, user: Pick<AuthUser, 'id' | 'email' | 'sede'> | null, entity: string, entityId: string, action: string, before: unknown, after: unknown, reason?: string | null) {
  await q.query('INSERT INTO audit_log (user_id, user_email, entity, entity_id, action, reason, before, after, sede_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [user?.id ?? null, user?.email ?? null, entity, entityId, action, reason ?? null, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), user?.sede ?? null]);
}
