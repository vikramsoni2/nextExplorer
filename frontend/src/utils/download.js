const defaultDownloadBase = (import.meta.env.VITE_DOWNLOAD_URL || '').replace(/\/$/, '');

export function buildDownloadAction(endpoint, preferredBase = '') {
  const normalizedEndpoint = typeof endpoint === 'string' && endpoint.startsWith('/') ? endpoint : `/${endpoint || ''}`;
  const base = String(preferredBase || defaultDownloadBase || '').replace(/\/$/, '');
  if (!base) return normalizedEndpoint;
  return `${base}${normalizedEndpoint}`;
}

export function submitDownloadForm(action, fields) {
  if (typeof document === 'undefined') return;
  const resolvedAction = String(action || '').trim();
  if (!resolvedAction) return;

  const iframeName = `download_${Math.random().toString(36).slice(2)}`;
  const iframe = document.createElement('iframe');
  iframe.name = iframeName;
  iframe.style.display = 'none';

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = resolvedAction;
  form.target = iframeName;
  form.style.display = 'none';

  const entries = Array.isArray(fields) ? fields : [];
  entries.forEach(({ name, value }) => {
    if (!name) return;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = String(name);
    input.value = value == null ? '' : String(value);
    form.appendChild(input);
  });

  document.body.appendChild(iframe);
  document.body.appendChild(form);
  form.submit();

  // Cleanup after the navigation has started.
  setTimeout(() => {
    try { document.body.removeChild(form); } catch (_) { /* ignore */ }
    try { document.body.removeChild(iframe); } catch (_) { /* ignore */ }
  }, 1000);
}

