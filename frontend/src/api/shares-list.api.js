import { requestJson } from './http';

export async function fetchSharesByMe() {
  const response = await requestJson('/api/shares', { method: 'GET' });
  return Array.isArray(response?.shares) ? response.shares : [];
}

export async function fetchSharesWithMe() {
  const response = await requestJson('/api/shares/with-me', { method: 'GET' });
  return Array.isArray(response?.shares) ? response.shares : [];
}

export async function deleteShare(shareId) {
  if (!shareId) {
    throw new Error('shareId is required');
  }
  await requestJson(`/api/shares/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
  });
}

