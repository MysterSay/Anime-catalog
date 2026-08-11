// Example for a browser extension / userscript after Python core returned the complete JSON object.
// Set INGEST_KEY only if you created the optional Cloudflare secret with that name.
async function sendCoreJsonToYoru(coreJson, ingestKey = '') {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (ingestKey) headers['X-Ingest-Key'] = ingestKey;

  const response = await fetch('https://myster-anime.pages.dev/api/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify(coreJson),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}
