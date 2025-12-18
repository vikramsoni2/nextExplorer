import { requestJson } from './http';

export async function getTrashItems() {
  return requestJson('/api/trash', { method: 'GET' });
}

export async function restoreTrashItem(id) {
  return requestJson('/api/trash/restore', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

