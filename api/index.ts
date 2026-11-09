import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const DATA_FILE = path.join('/tmp', 'sheet-mutations.json');

const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbz8e9-5I7UphS_hZvyh5YhC_v6yWSe7e7VFRK3BIKqEihMGab4RsOlQwll5sk_WlQZi/exec';
const STALE_APPS_SCRIPT_ID =
  'AKfycbx1OQXBULrG89F0pde3wXPPcmgYUQyO09r1Y5gDQQg';

function normalizeUrl(raw?: string): string {
  if (!raw) return DEFAULT_APPS_SCRIPT_URL;
  let url = raw.trim();
  if (!url.startsWith('https://script.google.com/')) return DEFAULT_APPS_SCRIPT_URL;
  if (url.includes(STALE_APPS_SCRIPT_ID)) return DEFAULT_APPS_SCRIPT_URL;
  const match = url.match(/\/macros\/s\/([^/?#]+)/);
  if (match && match[1] && match[1].length < 60) {
    return DEFAULT_APPS_SCRIPT_URL;
  }
  if (url.includes('/dev')) {
    url = url.split('/dev').join('/exec');
  }
  return url;
}

function readStore(): any {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return {
    jobTransfers: [],
    deliveryPoints: [],
    deliveryPointEdits: [],
    vehicleRegEdits: [],
    vehicleFieldEdits: [],
    jobTransferNoteEdits: [],
    repairRequests: [],
    repairApprovals: [],
    repairInspections: [],
    repairPhotoEdits: [],
    repairDetailEdits: [],
    repairReplyEdits: [],
    repairFinancialEdits: [],
    fuelRecords: [],
  };
}

function writeStore(store: any): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

app.get('/api/mutations', (_req, res) => {
  res.json(readStore());
});

app.post('/api/webhook-proxy', async (req, res) => {
  try {
    const { scriptUrl, payload } = req.body ?? {};
    const targetUrl = normalizeUrl(typeof scriptUrl === 'string' ? scriptUrl : undefined);
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload ?? {}),
      redirect: 'follow',
    });
    const text = await response.text();
    try {
      res.json(JSON.parse(text));
    } catch {
      res.json({ ok: response.ok, rawText: text });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/drive-photo', async (req, res) => {
  try {
    const filename = typeof req.query.filename === 'string' ? req.query.filename.trim() : '';
    const scriptUrlParam =
      typeof req.query.scriptUrl === 'string' ? req.query.scriptUrl.trim() : undefined;
    if (!filename) {
      res.status(400).json({ success: false, message: 'No filename provided' });
      return;
    }
    const store = readStore();
    const targetUrl = normalizeUrl(
      scriptUrlParam ||
        store.googleScriptUrl ||
        process.env.VITE_GOOGLE_SCRIPT_URL ||
        DEFAULT_APPS_SCRIPT_URL
    );
    const sep = targetUrl.includes('?') ? '&' : '?';
    const reqUrl = `${targetUrl}${sep}filename=${encodeURIComponent(filename)}`;
    const response = await fetch(reqUrl, { redirect: 'follow' });
    const text = await response.text();
    res.json(JSON.parse(text));
  } catch (err) {
    res.status(502).json({ success: false, error: String(err) });
  }
});

app.get('/api/script-url', (_req, res) => {
  const store = readStore();
  const candidate =
    store.googleScriptUrl ?? process.env.VITE_GOOGLE_SCRIPT_URL ?? DEFAULT_APPS_SCRIPT_URL;
  res.json({ scriptUrl: normalizeUrl(candidate) });
});

app.post('/api/script-url', (req, res) => {
  const store = readStore();
  const { scriptUrl } = req.body ?? {};
  if (typeof scriptUrl === 'string') {
    store.googleScriptUrl = normalizeUrl(scriptUrl);
    writeStore(store);
  }
  res.json({ ok: true, scriptUrl: store.googleScriptUrl });
});

app.get('/api/google-token', (_req, res) => {
  const store = readStore();
  if (
    store.googleAccessToken &&
    store.googleTokenExpiresAt &&
    store.googleTokenExpiresAt > Date.now() + 30000
  ) {
    res.json({
      accessToken: store.googleAccessToken,
      expiresAt: store.googleTokenExpiresAt,
    });
    return;
  }
  res.json({ accessToken: null, expiresAt: 0 });
});

app.post('/api/google-token', (req, res) => {
  const store = readStore();
  const { accessToken, expiresInSec } = req.body ?? {};
  if (typeof accessToken === 'string' && accessToken.trim()) {
    const ttl = typeof expiresInSec === 'number' && expiresInSec > 0 ? expiresInSec : 3500;
    store.googleAccessToken = accessToken.trim();
    store.googleTokenExpiresAt = Date.now() + ttl * 1000;
    writeStore(store);
  }
  res.json({ ok: true });
});

app.post('/api/mutations/job-transfer', (req, res) => {
  const store = readStore();
  const body = req.body ?? {};
  const recordId =
    typeof body.recordId === 'string' && body.recordId.trim()
      ? body.recordId.trim()
      : Math.random().toString(16).slice(2, 10);
  const baseRowNumber =
    typeof body.baseRowNumber === 'number' && body.baseRowNumber > 0
      ? body.baseRowNumber
      : 56278;
  const rowNumber =
    typeof body.rowNumber === 'number' && body.rowNumber > 0
      ? body.rowNumber
      : baseRowNumber + (store.jobTransfers?.length || 0) + 1;

  const values = body.values ?? {};
  const entry = {
    recordId,
    rowNumber,
    values,
    createdAt: new Date().toISOString(),
    syncedToSheet: Boolean(body.syncedToSheet),
  };

  if (!Array.isArray(store.jobTransfers)) store.jobTransfers = [];
  const existingIdx = store.jobTransfers.findIndex((j: any) => j.recordId === recordId);
  if (existingIdx >= 0) {
    store.jobTransfers[existingIdx] = entry;
  } else {
    store.jobTransfers.push(entry);
  }
  writeStore(store);

  res.json({ recordId, rowNumber, entry });
});

app.put('/api/mutations/job-transfer/:recordId', (req, res) => {
  const store = readStore();
  const { recordId } = req.params;
  const { rowNumber, endTime, duration, status } = req.body ?? {};

  let updated = false;
  if (Array.isArray(store.jobTransfers)) {
    for (const item of store.jobTransfers) {
      if (
        item.recordId === recordId ||
        (typeof rowNumber === 'number' && item.rowNumber === rowNumber)
      ) {
        if (typeof endTime === 'string') item.values['K'] = endTime;
        if (typeof duration === 'string') item.values['L'] = duration;
        if (typeof status === 'string') item.values['M'] = status;
        updated = true;
        break;
      }
    }
  }

  writeStore(store);
  res.json({ ok: true, updated });
});

app.all('*', (_req, res) => {
  res.json({ ok: true });
});

export default app;
