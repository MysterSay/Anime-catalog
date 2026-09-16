'use strict';

const EXT = globalThis.chrome || globalThis.browser;
const STREAM_PORT_NAME = 'anime-to-yoru-stream';

function runtimeErrorMessage(fallback = 'Extension API error') {
  try {
    return EXT?.runtime?.lastError?.message || fallback;
  } catch (_) {
    return fallback;
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function requestJson(message) {
  const method = String(message.method || 'GET').toUpperCase();
  const url = String(message.url || '');
  if (!isHttpUrl(url)) throw new Error('Некоректний URL для запиту.');

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: message.payload == null || method === 'GET' || method === 'HEAD'
      ? undefined
      : JSON.stringify(message.payload),
    cache: 'no-store',
    credentials: 'omit',
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

function createNotification(title, text) {
  if (!EXT.notifications?.create) return Promise.resolve();
  return new Promise(resolve => {
    try {
      EXT.notifications.create('', {
        type: 'basic',
        title: String(title || 'Anime → YORU'),
        message: String(text || ''),
        iconUrl: EXT.runtime.getURL('icons/icon-128.png'),
      }, () => {
        // Reading lastError prevents noisy unchecked errors on browsers where
        // notifications are disabled by policy/user settings.
        void EXT.runtime?.lastError;
        resolve();
      });
    } catch (_) {
      resolve();
    }
  });
}

EXT.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  if (message.type === 'requestJson') {
    requestJson(message)
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'notify') {
    createNotification(message.title, message.text)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'ping') {
    sendResponse({ ok: true, now: Date.now() });
    return true;
  }

  return undefined;
});

async function streamNdjson(port, requestId, url, payload, signal) {
  if (!isHttpUrl(url)) throw new Error('Некоректний stream URL.');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify(payload || {}),
    cache: 'no-store',
    credentials: 'omit',
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stream HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    let result = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const packet = JSON.parse(line);
        port.postMessage({ type: 'packet', requestId, packet });
        if (packet?.type === 'result' && packet.result) result = packet.result;
        if (packet?.type === 'error') throw new Error(`CORE:${packet.message || 'Python core error'}`);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let packet;
        try {
          packet = JSON.parse(line);
        } catch (_) {
          continue;
        }
        port.postMessage({ type: 'packet', requestId, packet });
        if (packet?.type === 'error') {
          throw new Error(`CORE:${packet.message || 'Python core завершився з помилкою.'}`);
        }
        if (packet?.type === 'result' && packet.result) {
          finalResult = packet.result;
          try { await reader.cancel(); } catch (_) {}
          return finalResult;
        }
      }
      if (done) break;
    }

    if (buffer.trim()) {
      try {
        const packet = JSON.parse(buffer);
        port.postMessage({ type: 'packet', requestId, packet });
        if (packet?.type === 'error') throw new Error(`CORE:${packet.message || 'Python core error'}`);
        if (packet?.type === 'result' && packet.result) finalResult = packet.result;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    return finalResult;
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
}

EXT.runtime.onConnect.addListener(port => {
  if (port.name !== STREAM_PORT_NAME) return;

  let controller = null;
  let activeRequestId = null;

  port.onMessage.addListener(message => {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'ping') {
      try {
        port.postMessage({ type: 'pong', requestId: message.requestId, at: Date.now() });
      } catch (_) {}
      return;
    }

    if (message.type !== 'start' || controller) return;

    const requestId = String(message.requestId || '');
    activeRequestId = requestId;
    controller = new AbortController();

    streamNdjson(port, requestId, String(message.url || ''), message.payload || {}, controller.signal)
      .then(result => {
        try {
          port.postMessage({ type: 'done', requestId, result: result || null });
        } catch (_) {}
      })
      .catch(error => {
        if (controller?.signal.aborted) return;
        try {
          port.postMessage({ type: 'error', requestId, error: String(error?.message || error) });
        } catch (_) {}
      });
  });

  port.onDisconnect.addListener(() => {
    if (controller && !controller.signal.aborted) {
      try { controller.abort(`Port disconnected: ${activeRequestId || 'unknown request'}`); } catch (_) {}
    }
  });
});
