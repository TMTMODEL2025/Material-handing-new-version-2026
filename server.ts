import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = process.env.VERCEL
  ? path.join('/tmp', 'sheet-mutations.json')
  : path.join(__dirname, 'sheet-mutations.json');

interface StoredJobTransfer {
  recordId: string;
  rowNumber: number;
  values: Record<string, string>;
  createdAt: string;
  syncedToSheet?: boolean;
}

interface StoredDeliveryPoint {
  id: string;
  rowNumber: number;
  values: Record<string, string>;
  createdAt: string;
  syncedToSheet?: boolean;
}

interface StoredDeliveryPointEdit {
  deliveryPoint: string;
  oldGate: string;
  newGate: string;
  updatedDate: string;
  updatedAt: string;
}

interface StoredVehicleRegEdit {
  oldRegistration: string;
  newRegistration: string;
  driverName: string;
  shift: string;
  updatedAt: string;
}

interface StoredVehicleFieldEdit {
  rowNumber: number;
  colId: string;
  value: string;
  updatedAt: string;
}

interface StoredJobTransferNoteEdit {
  rowNumber: number;
  date: string;
  driverName: string;
  vehicleNumber: string;
  startTime: string;
  note: string;
  updatedAt: string;
}

interface StoredRepairRequest {
  id: string;
  rowNumber: number;
  sequenceNo: string;
  values: Record<string, string>;
  createdAt: string;
  syncedToSheet?: boolean;
}

interface StoredRepairApproval {
  rowNumber: number;
  sequenceNo: string;
  approvalStatus: string;
  approverName: string;
  approvalDate: string;
  approvalTime: string;
  repairStatus?: string;
  note?: string;
  updatedAt: string;
}

interface StoredRepairPhotoEdit {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  photos: string[];
  updatedAt: string;
  syncedToSheet?: boolean;
}

interface StoredRepairDetailEdit {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  additionalDetails: string;
  updatedAt: string;
}

interface StoredRepairReplyEdit {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  replyDetails: string;
  updatedAt: string;
}

interface StoredRepairFinancialEdit {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  sparePartsCost: string;
  laborCost: string;
  updatedAt: string;
}

interface StoredRepairInspection {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  inspectorName: string;
  inspectionDate: string;
  inspectionTime: string;
  sparePartsCost?: string;
  laborCost?: string;
  note?: string;
  updatedAt: string;
}

interface StoredFuelRecord {
  id: string;
  rowNumber: number;
  values: Record<string, string>;
  createdAt: string;
  syncedToSheet?: boolean;
}

interface MutationsStore {
  jobTransfers: StoredJobTransfer[];
  deliveryPoints: StoredDeliveryPoint[];
  deliveryPointEdits: StoredDeliveryPointEdit[];
  vehicleRegEdits: StoredVehicleRegEdit[];
  vehicleFieldEdits: StoredVehicleFieldEdit[];
  jobTransferNoteEdits: StoredJobTransferNoteEdit[];
  repairRequests: StoredRepairRequest[];
  repairApprovals: StoredRepairApproval[];
  repairInspections: StoredRepairInspection[];
  repairPhotoEdits: StoredRepairPhotoEdit[];
  repairDetailEdits: StoredRepairDetailEdit[];
  repairReplyEdits: StoredRepairReplyEdit[];
  repairFinancialEdits: StoredRepairFinancialEdit[];
  fuelRecords: StoredFuelRecord[];
  googleAccessToken?: string;
  googleTokenExpiresAt?: number;
  googleScriptUrl?: string;
}

function isRecentMutation(tsStr?: string, maxAgeMs = 20000): boolean {
  if (!tsStr) return false;
  const ts = new Date(tsStr).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= maxAgeMs;
}

function readStore(): MutationsStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<MutationsStore>;
      return {
        jobTransfers: Array.isArray(parsed.jobTransfers) ? parsed.jobTransfers : [],
        deliveryPoints: Array.isArray(parsed.deliveryPoints) ? parsed.deliveryPoints : [],
        deliveryPointEdits: Array.isArray(parsed.deliveryPointEdits)
          ? parsed.deliveryPointEdits
          : [],
        vehicleRegEdits: Array.isArray(parsed.vehicleRegEdits)
          ? parsed.vehicleRegEdits
          : [],
        vehicleFieldEdits: Array.isArray(parsed.vehicleFieldEdits)
          ? parsed.vehicleFieldEdits
          : [],
        jobTransferNoteEdits: Array.isArray(parsed.jobTransferNoteEdits)
          ? parsed.jobTransferNoteEdits
          : [],
        repairRequests: Array.isArray(parsed.repairRequests)
          ? parsed.repairRequests.filter((r) => isRecentMutation(r.createdAt))
          : [],
        repairApprovals: Array.isArray(parsed.repairApprovals)
          ? parsed.repairApprovals.filter((a) => isRecentMutation(a.updatedAt))
          : [],
        repairInspections: Array.isArray(parsed.repairInspections)
          ? parsed.repairInspections.filter((i) => isRecentMutation(i.updatedAt))
          : [],
        repairPhotoEdits: Array.isArray(parsed.repairPhotoEdits)
          ? parsed.repairPhotoEdits.filter((p) => isRecentMutation(p.updatedAt))
          : [],
        repairDetailEdits: Array.isArray(parsed.repairDetailEdits)
          ? parsed.repairDetailEdits.filter((d) => isRecentMutation(d.updatedAt))
          : [],
        repairReplyEdits: Array.isArray(parsed.repairReplyEdits)
          ? parsed.repairReplyEdits.filter((r) => isRecentMutation(r.updatedAt))
          : [],
        repairFinancialEdits: Array.isArray(parsed.repairFinancialEdits)
          ? parsed.repairFinancialEdits.filter((f) => isRecentMutation(f.updatedAt))
          : [],
        fuelRecords: Array.isArray(parsed.fuelRecords) ? parsed.fuelRecords : [],
        googleAccessToken:
          typeof parsed.googleAccessToken === 'string'
            ? parsed.googleAccessToken
            : undefined,
        googleTokenExpiresAt:
          typeof parsed.googleTokenExpiresAt === 'number'
            ? parsed.googleTokenExpiresAt
            : undefined,
        googleScriptUrl:
          typeof parsed.googleScriptUrl === 'string'
            ? parsed.googleScriptUrl
            : undefined,
      };
    }
  } catch (err) {
    console.error('Error reading mutations store:', err);
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

function writeStore(store: MutationsStore): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing mutations store:', err);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  });

  app.get('/api/mutations', (_req, res) => {
    const store = readStore();
    res.json(store);
  });

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
        const json = JSON.parse(text);
        res.json(json);
      } catch {
        res.status(502).json({
          ok: false,
          error: 'Apps Script did not return valid JSON',
          rawText: text,
        });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  const drivePhotoServerCache = new Map<
    string,
    { data: Record<string, unknown>; expiresAt: number }
  >();

  app.get('/api/drive-photo', async (req, res) => {
    try {
      const filename = typeof req.query.filename === 'string' ? req.query.filename.trim() : '';
      const scriptUrlParam =
        typeof req.query.scriptUrl === 'string' ? req.query.scriptUrl.trim() : undefined;
      if (!filename) {
        res.status(400).json({ success: false, message: 'No filename provided' });
        return;
      }

      const cached = drivePhotoServerCache.get(filename);
      if (cached && cached.expiresAt > Date.now()) {
        res.json(cached.data);
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(reqUrl, {
          redirect: 'follow',
          signal: controller.signal,
        });
        const text = await response.text();
        const json = JSON.parse(text) as Record<string, unknown>;
        if (json && (json.success || json.base64 || json.fileId || json.url)) {
          drivePhotoServerCache.set(filename, {
            data: json,
            expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour cache for found photos
          });
        } else {
          drivePhotoServerCache.set(filename, {
            data: json,
            expiresAt: Date.now() + 2 * 60 * 1000, // 2 min cache for misses
          });
        }
        res.json(json);
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      res.status(502).json({ success: false, error: String(err) });
    }
  });

  app.get('/api/script-url', (_req, res) => {
    const store = readStore();
    const candidate =
      store.googleScriptUrl ??
      process.env.VITE_GOOGLE_SCRIPT_URL ??
      DEFAULT_APPS_SCRIPT_URL;
    res.json({
      scriptUrl: normalizeUrl(candidate),
    });
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
      const ttl =
        typeof expiresInSec === 'number' && expiresInSec > 0 ? expiresInSec : 3500;
      store.googleAccessToken = accessToken.trim();
      store.googleTokenExpiresAt = Date.now() + ttl * 1000;
      writeStore(store);
    }
    res.json({ ok: true });
  });

  app.post('/api/mutations/mark-synced', (req, res) => {
    const store = readStore();
    const { recordId, repairId, sheetRowNumber } = req.body ?? {};
    let changed = false;
    if (typeof recordId === 'string' && recordId) {
      for (const jt of store.jobTransfers) {
        if (jt.recordId === recordId) {
          jt.syncedToSheet = true;
          if (typeof sheetRowNumber === 'number' && sheetRowNumber > 0) {
            jt.rowNumber = sheetRowNumber;
          }
          changed = true;
        }
      }
    }
    if (typeof repairId === 'string' && repairId) {
      for (const rr of store.repairRequests) {
        if (rr.id === repairId) {
          rr.syncedToSheet = true;
          if (typeof sheetRowNumber === 'number' && sheetRowNumber > 0) {
            rr.rowNumber = sheetRowNumber;
          }
          changed = true;
        }
      }
    }
    if (changed) {
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
        : baseRowNumber + store.jobTransfers.length + 1;

    const values: Record<string, string> = body.values ?? {};
    const entry: StoredJobTransfer = {
      recordId,
      rowNumber,
      values,
      createdAt: new Date().toISOString(),
      syncedToSheet: Boolean(body.syncedToSheet),
    };

    const existingIdx = store.jobTransfers.findIndex((j) => j.recordId === recordId);
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

    writeStore(store);
    res.json({ ok: true, updated });
  });

  app.post('/api/mutations/delivery-point', (req, res) => {
    const store = readStore();
    const body = req.body ?? {};
    const id = Math.random().toString(16).slice(2, 10);
    const baseRowNumber =
      typeof body.baseRowNumber === 'number' && body.baseRowNumber > 0
        ? body.baseRowNumber
        : 25;
    const rowNumber = baseRowNumber + store.deliveryPoints.length + 1;

    const values: Record<string, string> = body.values ?? {};
    const entry: StoredDeliveryPoint = {
      id,
      rowNumber,
      values,
      createdAt: new Date().toISOString(),
    };

    store.deliveryPoints.push(entry);
    writeStore(store);

    res.json({ id, rowNumber, entry });
  });

  app.put('/api/mutations/delivery-point-gate', (req, res) => {
    const store = readStore();
    const { deliveryPoint, oldGate, newGate, updatedDate } = req.body ?? {};
    const pt = String(deliveryPoint ?? '').trim();
    const og = String(oldGate ?? '').trim();
    const ng = String(newGate ?? '').trim();
    const dt = String(updatedDate ?? '').trim();

    if (!pt || !ng) {
      res.status(400).json({ error: 'ข้อมูลจุดส่งสินค้าหรือประตูไม่ครบถ้วน' });
      return;
    }

    // Update if it was a newly created deliveryPoint
    for (const dp of store.deliveryPoints) {
      if ((dp.values['B'] ?? '').trim() === pt) {
        dp.values['C'] = ng;
        if (dt) dp.values['A'] = dt;
      }
    }

    const existingIdx = store.deliveryPointEdits.findIndex(
      (e) => e.deliveryPoint === pt
    );
    const editEntry: StoredDeliveryPointEdit = {
      deliveryPoint: pt,
      oldGate: og,
      newGate: ng,
      updatedDate: dt,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.deliveryPointEdits[existingIdx] = editEntry;
    } else {
      store.deliveryPointEdits.push(editEntry);
    }

    writeStore(store);
    res.json({ ok: true, edit: editEntry });
  });

  app.put('/api/mutations/vehicle-registration', (req, res) => {
    const store = readStore();
    const { oldRegistration, newRegistration, driverName, shift } = req.body ?? {};
    const oldReg = String(oldRegistration ?? '').trim();
    const newReg = String(newRegistration ?? '').trim();
    const drv = String(driverName ?? '').trim();
    const shf = String(shift ?? '').trim();

    if (!oldReg || !newReg) {
      res.status(400).json({ error: 'ข้อมูลทะเบียนรถไม่ครบถ้วน' });
      return;
    }

    // Chain edits if a previously edited vehicle registration is edited again
    const chainedIdx = store.vehicleRegEdits.findIndex(
      (e) => e.newRegistration === oldReg && e.driverName === drv && e.shift === shf
    );

    if (chainedIdx >= 0) {
      store.vehicleRegEdits[chainedIdx].newRegistration = newReg;
      store.vehicleRegEdits[chainedIdx].updatedAt = new Date().toISOString();
    } else {
      store.vehicleRegEdits.push({
        oldRegistration: oldReg,
        newRegistration: newReg,
        driverName: drv,
        shift: shf,
        updatedAt: new Date().toISOString(),
      });
    }

    writeStore(store);
    res.json({ ok: true });
  });

  app.put('/api/mutations/vehicle-field', (req, res) => {
    const store = readStore();
    const { rowNumber, colId, newValue } = req.body ?? {};
    const rn = typeof rowNumber === 'number' ? rowNumber : Number(rowNumber) || 0;
    const cid = String(colId ?? '').trim().toUpperCase();
    const val = String(newValue ?? '').trim();

    if (rn <= 0 || !cid) {
      res.status(400).json({ error: 'ข้อมูลแถวหรือคอลัมน์ไม่ครบถ้วน' });
      return;
    }

    const existingIdx = store.vehicleFieldEdits.findIndex(
      (e) => e.rowNumber === rn && e.colId === cid
    );
    const entry: StoredVehicleFieldEdit = {
      rowNumber: rn,
      colId: cid,
      value: val,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.vehicleFieldEdits[existingIdx] = entry;
    } else {
      store.vehicleFieldEdits.push(entry);
    }

    writeStore(store);
    res.json({ ok: true, entry });
  });

  app.put('/api/mutations/job-transfer-note', (req, res) => {
    const store = readStore();
    const { rowNumber, date, driverName, vehicleNumber, startTime, note } =
      req.body ?? {};
    const rn = typeof rowNumber === 'number' ? rowNumber : 0;
    const dt = String(date ?? '').trim();
    const drv = String(driverName ?? '').trim();
    const veh = String(vehicleNumber ?? '').trim();
    const st = String(startTime ?? '').trim();
    const nt = String(note ?? '').trim();

    for (const jt of store.jobTransfers) {
      if (
        (jt.values['A'] ?? '').trim() === dt &&
        (jt.values['C'] ?? '').trim() === drv &&
        (jt.values['D'] ?? '').trim() === veh &&
        (jt.values['I'] ?? '').trim() === st
      ) {
        jt.values['N'] = nt;
        jt.values['R'] = nt;
      }
    }

    const existingIdx = store.jobTransferNoteEdits.findIndex(
      (e) =>
        e.date === dt &&
        e.driverName === drv &&
        e.vehicleNumber === veh &&
        e.startTime === st
    );

    const editEntry: StoredJobTransferNoteEdit = {
      rowNumber: rn,
      date: dt,
      driverName: drv,
      vehicleNumber: veh,
      startTime: st,
      note: nt,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.jobTransferNoteEdits[existingIdx] = editEntry;
    } else {
      store.jobTransferNoteEdits.push(editEntry);
    }

    writeStore(store);
    res.json({ ok: true, edit: editEntry });
  });

  app.post('/api/mutations/repair-request', (req, res) => {
    const store = readStore();
    const body = req.body ?? {};
    const id =
      typeof body.id === 'string' && body.id.trim()
        ? body.id.trim()
        : Math.random().toString(16).slice(2, 10);
    const rowNumber =
      typeof body.rowNumber === 'number' && body.rowNumber > 0
        ? body.rowNumber
        : 4270 + store.repairRequests.length;
    const sequenceNo = String(body.sequenceNo ?? rowNumber - 1);
    const values: Record<string, string> = body.values ?? {};

    const entry: StoredRepairRequest = {
      id,
      rowNumber,
      sequenceNo,
      values,
      createdAt: new Date().toISOString(),
      syncedToSheet: Boolean(body.syncedToSheet),
    };

    store.repairRequests.push(entry);
    writeStore(store);

    res.json({ ok: true, entry });
  });

  app.put('/api/mutations/repair-approval', (req, res) => {
    const store = readStore();
    const {
      rowNumber,
      sequenceNo,
      approvalStatus,
      approverName,
      approvalDate,
      approvalTime,
      repairStatus,
      note,
    } = req.body ?? {};

    const rn = typeof rowNumber === 'number' ? rowNumber : 0;
    const seq = String(sequenceNo ?? '').trim();
    const status = String(approvalStatus ?? '').trim();
    const approver = String(approverName ?? '').trim();
    const appDate = String(approvalDate ?? '').trim();
    const appTime = String(approvalTime ?? '').trim();
    const repStatus = String(repairStatus ?? '').trim();
    const nt = String(note ?? '').trim();

    for (const reqItem of store.repairRequests) {
      if (
        (seq && reqItem.sequenceNo === seq) ||
        (rn > 0 && reqItem.rowNumber === rn)
      ) {
        reqItem.values['AE'] = approver;
        reqItem.values['AF'] = appDate;
        reqItem.values['AG'] = appTime;
        reqItem.values['AI'] = status;
        if (repStatus) reqItem.values['P'] = repStatus;
        if (nt) reqItem.values['AH'] = nt;
      }
    }

    const existingIdx = store.repairApprovals.findIndex(
      (a) => (seq && a.sequenceNo === seq) || (rn > 0 && a.rowNumber === rn)
    );

    const approvalEntry: StoredRepairApproval = {
      rowNumber: rn,
      sequenceNo: seq,
      approvalStatus: status,
      approverName: approver,
      approvalDate: appDate,
      approvalTime: appTime,
      repairStatus: repStatus || undefined,
      note: nt || undefined,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.repairApprovals[existingIdx] = approvalEntry;
    } else {
      store.repairApprovals.push(approvalEntry);
    }

    writeStore(store);
    res.json({ ok: true, approval: approvalEntry });
  });

  app.put('/api/mutations/repair-inspection', (req, res) => {
    const store = readStore();
    const {
      rowNumber,
      sequenceNo,
      repairRequestNo,
      inspectorName,
      inspectionDate,
      inspectionTime,
      sparePartsCost,
      laborCost,
      note,
    } = req.body ?? {};

    const rn = typeof rowNumber === 'number' ? rowNumber : 0;
    const seq = String(sequenceNo ?? '').trim();
    const reqNo = String(repairRequestNo ?? '').trim();
    const inspector = String(inspectorName ?? '').trim();
    const inspDate = String(inspectionDate ?? '').trim();
    const inspTime = String(inspectionTime ?? '').trim();
    const spare = sparePartsCost !== undefined ? String(sparePartsCost).trim() : undefined;
    const labor = laborCost !== undefined ? String(laborCost).trim() : undefined;
    const nt = note !== undefined ? String(note).trim() : undefined;

    for (const reqItem of store.repairRequests) {
      if (
        (seq && reqItem.sequenceNo === seq) ||
        (reqNo && reqItem.values['G'] === reqNo) ||
        (rn > 0 && reqItem.rowNumber === rn)
      ) {
        reqItem.values['AB'] = inspector;
        reqItem.values['AC'] = inspDate;
        reqItem.values['AD'] = inspTime;
        reqItem.values['P'] = 'ตรวจสอบแล้ว';
        reqItem.values['AI'] = '2.⚠️รออนุมัติ';
        if (spare !== undefined) reqItem.values['N'] = spare;
        if (labor !== undefined) reqItem.values['O'] = labor;
        if (nt !== undefined && nt !== '') reqItem.values['AH'] = nt;
      }
    }

    if (!store.repairInspections) {
      store.repairInspections = [];
    }

    const existingIdx = store.repairInspections.findIndex(
      (i) =>
        (seq && i.sequenceNo === seq) ||
        (reqNo && i.repairRequestNo === reqNo) ||
        (rn > 0 && i.rowNumber === rn)
    );

    const inspectionEntry: StoredRepairInspection = {
      rowNumber: rn,
      sequenceNo: seq,
      repairRequestNo: reqNo || undefined,
      inspectorName: inspector,
      inspectionDate: inspDate,
      inspectionTime: inspTime,
      sparePartsCost: spare,
      laborCost: labor,
      note: nt,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.repairInspections[existingIdx] = inspectionEntry;
    } else {
      store.repairInspections.push(inspectionEntry);
    }

    writeStore(store);
    res.json({ ok: true, inspection: inspectionEntry });
  });

  app.put('/api/mutations/repair-photos', (req, res) => {
    const store = readStore();
    const { rowNumber, sequenceNo, repairRequestNo, photos, syncedToSheet } = req.body ?? {};
    const rn = typeof rowNumber === 'number' ? rowNumber : 0;
    const seq = String(sequenceNo ?? '').trim();
    const reqNo = String(repairRequestNo ?? '').trim();
    const rawList = Array.isArray(photos) ? photos : [];
    const photoList = Array.from({ length: 9 }, (_, idx) =>
      String(rawList[idx] ?? '').trim()
    );

    const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];

    // Update if it was previously in repairRequests
    for (const reqItem of store.repairRequests) {
      if (
        (seq && reqItem.sequenceNo === seq) ||
        (reqNo && reqItem.values['G'] === reqNo) ||
        (rn > 0 && reqItem.rowNumber === rn)
      ) {
        photoCols.forEach((col, idx) => {
          reqItem.values[col] = photoList[idx];
        });
      }
    }

    const existingIdx = store.repairPhotoEdits.findIndex(
      (p) =>
        (seq && p.sequenceNo === seq) ||
        (reqNo && p.repairRequestNo === reqNo) ||
        (rn > 0 && p.rowNumber === rn)
    );

    const editEntry: StoredRepairPhotoEdit = {
      rowNumber: rn,
      sequenceNo: seq,
      repairRequestNo: reqNo,
      photos: photoList,
      updatedAt: new Date().toISOString(),
      syncedToSheet: Boolean(syncedToSheet),
    };

    if (existingIdx >= 0) {
      store.repairPhotoEdits[existingIdx] = editEntry;
    } else {
      store.repairPhotoEdits.push(editEntry);
    }

    writeStore(store);
    res.json({ ok: true, edit: editEntry });
  });

  app.put('/api/mutations/repair-details', (req, res) => {
    const store = readStore();
    const { rowNumber, sequenceNo, repairRequestNo, additionalDetails } = req.body ?? {};
    const rn = typeof rowNumber === 'number' ? rowNumber : 0;
    const seq = String(sequenceNo ?? '').trim();
    const reqNo = String(repairRequestNo ?? '').trim();
    const details = String(additionalDetails ?? '').trim();

    for (const reqItem of store.repairRequests) {
      if (
        (seq && reqItem.sequenceNo === seq) ||
        (reqNo && reqItem.values['G'] === reqNo) ||
        (rn > 0 && reqItem.rowNumber === rn)
      ) {
        reqItem.values['AK'] = details;
      }
    }

    if (!store.repairDetailEdits) {
      store.repairDetailEdits = [];
    }

    const existingIdx = store.repairDetailEdits.findIndex(
      (d) =>
        (seq && d.sequenceNo === seq) ||
        (reqNo && d.repairRequestNo === reqNo) ||
        (rn > 0 && d.rowNumber === rn)
    );

    const editEntry: StoredRepairDetailEdit = {
      rowNumber: rn,
      sequenceNo: seq,
      repairRequestNo: reqNo,
      additionalDetails: details,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.repairDetailEdits[existingIdx] = editEntry;
    } else {
      store.repairDetailEdits.push(editEntry);
    }

    writeStore(store);
    res.json({ ok: true, edit: editEntry });
  });

  app.put('/api/mutations/repair-reply', (req, res) => {
    const store = readStore();
    const { rowNumber, sequenceNo, repairRequestNo, replyDetails } = req.body ?? {};
    const rn = typeof rowNumber === 'number' ? rowNumber : 0;
    const seq = String(sequenceNo ?? '').trim();
    const reqNo = String(repairRequestNo ?? '').trim();
    const reply = String(replyDetails ?? '').trim();

    for (const reqItem of store.repairRequests) {
      if (
        (seq && reqItem.sequenceNo === seq) ||
        (reqNo && reqItem.values['G'] === reqNo) ||
        (rn > 0 && reqItem.rowNumber === rn)
      ) {
        reqItem.values['AM'] = reply;
      }
    }

    if (!store.repairReplyEdits) {
      store.repairReplyEdits = [];
    }

    const existingIdx = store.repairReplyEdits.findIndex(
      (d) =>
        (seq && d.sequenceNo === seq) ||
        (reqNo && d.repairRequestNo === reqNo) ||
        (rn > 0 && d.rowNumber === rn)
    );

    const editEntry: StoredRepairReplyEdit = {
      rowNumber: rn,
      sequenceNo: seq,
      repairRequestNo: reqNo,
      replyDetails: reply,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.repairReplyEdits[existingIdx] = editEntry;
    } else {
      store.repairReplyEdits.push(editEntry);
    }

    writeStore(store);
    res.json({ ok: true, edit: editEntry });
  });

  app.put('/api/mutations/repair-financial', (req, res) => {
    const store = readStore();
    const { rowNumber, sequenceNo, repairRequestNo, sparePartsCost, laborCost } =
      req.body ?? {};
    const rn = typeof rowNumber === 'number' ? rowNumber : 0;
    const seq = String(sequenceNo ?? '').trim();
    const reqNo = String(repairRequestNo ?? '').trim();
    const spare = String(sparePartsCost ?? '').trim();
    const labor = String(laborCost ?? '').trim();

    for (const reqItem of store.repairRequests) {
      if (
        (seq && reqItem.sequenceNo === seq) ||
        (reqNo && reqItem.values['G'] === reqNo) ||
        (rn > 0 && reqItem.rowNumber === rn)
      ) {
        reqItem.values['N'] = spare;
        reqItem.values['O'] = labor;
      }
    }

    if (!store.repairFinancialEdits) {
      store.repairFinancialEdits = [];
    }

    const existingIdx = store.repairFinancialEdits.findIndex(
      (f) =>
        (seq && f.sequenceNo === seq) ||
        (reqNo && f.repairRequestNo === reqNo) ||
        (rn > 0 && f.rowNumber === rn)
    );

    const editEntry: StoredRepairFinancialEdit = {
      rowNumber: rn,
      sequenceNo: seq,
      repairRequestNo: reqNo,
      sparePartsCost: spare,
      laborCost: labor,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.repairFinancialEdits[existingIdx] = editEntry;
    } else {
      store.repairFinancialEdits.push(editEntry);
    }

    writeStore(store);
    res.json({ ok: true, edit: editEntry });
  });

  app.post('/api/mutations/fuel-record', (req, res) => {
    const store = readStore();
    const { id, rowNumber, values, syncedToSheet } = req.body ?? {};
    const recId = String(id ?? '').trim() || `fuel-${Date.now()}`;
    const rn = typeof rowNumber === 'number' ? rowNumber : store.fuelRecords.length + 1;

    if (!store.fuelRecords) {
      store.fuelRecords = [];
    }

    const existingIdx = store.fuelRecords.findIndex((f) => f.id === recId);
    const entry: StoredFuelRecord = {
      id: recId,
      rowNumber: rn,
      values: typeof values === 'object' && values ? values : {},
      createdAt: new Date().toISOString(),
      syncedToSheet: Boolean(syncedToSheet),
    };

    if (existingIdx >= 0) {
      store.fuelRecords[existingIdx] = entry;
    } else {
      store.fuelRecords.push(entry);
    }

    writeStore(store);
    res.json({ ok: true, id: recId, rowNumber: rn });
  });

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
