import { requestJson } from './http';

async function listTrash() {
  return requestJson('/api/trash', {
    method: 'GET',
  });
}

async function restoreTrashItems(ids) {
  const payload = Array.isArray(ids) ? ids : [ids];
  return requestJson('/api/trash/restore', {
    method: 'POST',
    body: JSON.stringify({ ids: payload }),
  });
}

async function deleteTrashItems(ids) {
  const payload = Array.isArray(ids) ? ids : [ids];
  return requestJson('/api/trash', {
    method: 'DELETE',
    body: JSON.stringify({ ids: payload }),
  });
}

export {
  listTrash,
  restoreTrashItems,
  deleteTrashItems,
};

