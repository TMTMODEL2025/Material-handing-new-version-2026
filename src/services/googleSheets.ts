import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  DeliveryPointPayload,
  FuelRecordPayload,
  JobTransferPayload,
  SheetColumn,
  SheetDataResult,
  SheetRow,
  SheetTabConfig,
} from '../types';

export const GOOGLE_SHEET_ID = '1Dn72dYdEGz3GBvk3O5n1FN0RCKv5S1IvgLeA5M5RzWc';
export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => {
  provider.addScope(scope);
});

// In-memory OAuth token cache (never required for normal app usage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;

onAuthStateChanged(auth, (user: User | null) => {
  if (!user && !isSigningIn) {
    cachedAccessToken = null;
    cachedTokenExpiresAt = 0;
  }
});

const APPS_SCRIPT_URL_STORAGE_KEY = 'gsheets_apps_script_url_v1';
const LOCAL_MUTATIONS_STORAGE_KEY = 'gsheets_local_mutations_v3';

// Detect if running in a static deployment (e.g. Vercel, GitHub Pages) without Express backend API
export let isBackendApiAvailable: boolean | null = null;

export function safeBackendFetch(url: string, init?: RequestInit): Promise<Response> | null {
  if (isBackendApiAvailable === false) return null;
  return fetch(url, init)
    .then((res) => {
      if (res.status === 404) {
        isBackendApiAvailable = false;
      }
      return res;
    })
    .catch((err) => {
      isBackendApiAvailable = false;
      throw err;
    });
}

export function backendPost(url: string, bodyObj: unknown, method = 'POST'): void {
  if (isBackendApiAvailable === false) return;
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  })
    .then((res) => {
      if (res.status === 404) isBackendApiAvailable = false;
    })
    .catch(() => {
      isBackendApiAvailable = false;
    });
}


export const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbz8e9-5I7UphS_hZvyh5YhC_v6yWSe7e7VFRK3BIKqEihMGab4RsOlQwll5sk_WlQZi/exec';

export const STALE_APPS_SCRIPT_ID =
  'AKfycbx1OQXBULrG89F0pde3wXPPcmgYUQyO09r1Y5gDQQg';

export function normalizeAppsScriptUrl(raw?: string): string {
  if (!raw) return DEFAULT_APPS_SCRIPT_URL;
  let url = raw.trim();
  if (!url.startsWith('https://script.google.com/')) {
    return DEFAULT_APPS_SCRIPT_URL;
  }
  if (url.includes(STALE_APPS_SCRIPT_ID)) {
    return DEFAULT_APPS_SCRIPT_URL;
  }
  const match = url.match(/\/macros\/s\/([^/?#]+)/);
  if (match && match[1] && match[1].length < 60) {
    return DEFAULT_APPS_SCRIPT_URL;
  }
  if (url.includes('/dev')) {
    url = url.split('/dev').join('/exec');
  }
  return url;
}

let configuredAppsScriptUrl: string =
  normalizeAppsScriptUrl((import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined)?.trim());

try {
  const savedUrl = localStorage.getItem(APPS_SCRIPT_URL_STORAGE_KEY)?.trim();
  if (savedUrl && savedUrl.startsWith('https://script.google.com/')) {
    const normalized = normalizeAppsScriptUrl(savedUrl);
    configuredAppsScriptUrl = normalized;
    if (normalized !== savedUrl) {
      localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, normalized);
    }
  } else {
    configuredAppsScriptUrl = DEFAULT_APPS_SCRIPT_URL;
    localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, DEFAULT_APPS_SCRIPT_URL);
  }
} catch {
  // ignore storage errors
}

export function getConfiguredAppsScriptUrl(): string {
  configuredAppsScriptUrl = normalizeAppsScriptUrl(configuredAppsScriptUrl);
  return configuredAppsScriptUrl || DEFAULT_APPS_SCRIPT_URL;
}

export async function saveConfiguredAppsScriptUrl(url: string): Promise<void> {
  const clean = normalizeAppsScriptUrl(url);
  configuredAppsScriptUrl = clean;
  try {
    if (clean) {
      localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(APPS_SCRIPT_URL_STORAGE_KEY);
    }
  } catch {
    // ignore
  }

  if (isBackendApiAvailable !== false) {
    void safeBackendFetch('/api/script-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptUrl: clean }),
    })?.catch(() => {
      // ignore on static hosting
    });
  }

  if (clean && clean.startsWith('https://script.google.com/')) {
    try {
      await callAppsScriptWebhook(clean, {
        action: 'registerWebhookUrl',
        url: clean,
      });
    } catch {
      // ignore if script doesn't support registerWebhookUrl yet
    }
    void flushPendingMutationsToGoogleSheet();
  }
}

export const GOOGLE_APPS_SCRIPT_CODE = `// โค้ดสำหรับเชื่อมต่อ Google Sheets แบบไม่ต้องยืนยันสิทธิ์ล็อกอิน (No-Login)
// วิธีติดตั้งเพียงครั้งเดียว:
// 1. เปิดไฟล์ Google Sheet -> เมนู "ส่วนขยาย (Extensions)" -> "Apps Script"
// 2. ลบโค้ดเดิมในไฟล์ออกทั้งหมด (หากมีไฟล์ .gs อื่นที่ประกาศ SHEET_ID ซ้ำ ให้ลบตัวแปรซ้ำออก) แล้ววางโค้ดนี้ลงไป กดบันทึก (Ctrl+S)
// 3. กดปุ่ม "การทำให้ใช้งานได้ (Deploy)" มุมขวาบน -> "การทำให้ใช้งานได้รายการใหม่ (New deployment)" (หรือจัดการการทำให้ใช้งานได้ -> แก้ไข -> เวอร์ชันใหม่)
// 4. เลือกประเภทเป็น "เว็บแอป (Web app)"
//    - ดำเนินการในฐานะ (Execute as): เลือก "ฉัน (Me)"
//    - ผู้ที่มีสิทธิ์เข้าถึง (Who has access): เลือก "ทุกคน (Anyone)"
// 5. กด "การทำให้ใช้งานได้ (Deploy)" แล้วคัดลอก URL ของเว็บแอปมาวางในแอป 1 ครั้ง (หรือกดเรียกใช้ฟังก์ชัน เชื่อมต่ออัตโนมัติ ด้านล่าง)

function getTargetSpreadsheet_() {
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (err) {}
  return SpreadsheetApp.openById('${GOOGLE_SHEET_ID}');
}

function saveBase64ImageToDrive(base64Data, prefix) {
  if (!base64Data || typeof base64Data !== 'string') return '';
  if (base64Data.indexOf('http') === 0) return base64Data;
  if (base64Data.indexOf('data:image') !== 0) return base64Data;

  try {
    var folder;
    try {
      folder = DriveApp.getFolderById('1y9_CzTkunm85vparUxDGg_lvCH0sa6P0');
    } catch (folderErr) {
      folder = DriveApp.getRootFolder();
    }
    var parts = base64Data.split(',');
    var contentType = parts[0].split(':')[1].split(';')[0];
    var decoded = Utilities.base64Decode(parts[1]);
    var ext = contentType.indexOf('png') >= 0 ? 'png' : 'jpg';
    var fileName = (prefix || 'repair') + '_' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd_HHmmss') + '_' + Math.floor(Math.random() * 1000) + '.' + ext;
    var blob = Utilities.newBlob(decoded, contentType, fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://lh3.googleusercontent.com/d/' + file.getId();
  } catch (err) {
    return base64Data.length <= 48000 ? base64Data : '';
  }
}

function เชื่อมต่ออัตโนมัติ() {
  var ss = getTargetSpreadsheet_();
  var url = ScriptApp.getService().getUrl();
  if (!url || url.indexOf('/dev') >= 0 || url.indexOf('AKfycbx1OQXBULrG89F0pde3wXPPcmgYUQyO09r1Y5gDQQg') >= 0) {
    url = '${DEFAULT_APPS_SCRIPT_URL}';
  }
  var dpSheet = ss.getSheetByName('จุดส่งสินค้า');
  if (dpSheet) {
    dpSheet.getRange('D1').setValue(url);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var rawContents = (e && e.postData && e.postData.contents) ? String(e.postData.contents) : '{}';
    var body = {};
    try {
      body = JSON.parse(rawContents);
    } catch (parseErr) {
      body = {};
    }
    var action = body.action;
    var ss = getTargetSpreadsheet_();

    if (action === 'registerWebhookUrl') {
      var dpSheet = ss.getSheetByName('จุดส่งสินค้า');
      if (dpSheet && body.url) {
        dpSheet.getRange('D1').setValue(String(body.url).trim());
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'appendJobTransfer') {
      var sheet = ss.getSheetByName('บันทึกการย้ายงาน');
      var rowValues = body.rowValues || [];
      sheet.appendRow(rowValues);
      var rowNumber = sheet.getLastRow();
      return jsonResponse({ ok: true, rowNumber: rowNumber });
    }

    if (action === 'completeJobTransfer') {
      var sheet = ss.getSheetByName('บันทึกการย้ายงาน');
      var lastRow = sheet.getLastRow();
      var targetRow = Number(body.rowNumber) || 0;
      var recordId = String(body.recordId || '').trim();

      if (recordId && lastRow >= 2) {
        var startRow = Math.max(2, lastRow - 300);
        var numRows = lastRow - startRow + 1;
        var ids = sheet.getRange(startRow, 17, numRows, 1).getValues();
        for (var i = ids.length - 1; i >= 0; i--) {
          if (String(ids[i][0] || '').trim() === recordId) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        sheet.getRange(targetRow, 11, 1, 3).setValues([[
          body.endTime || '',
          body.duration || '',
          body.status || 'ส่งสินค้าเรียบร้อยแล้ว'
        ]]);
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    if (action === 'appendDeliveryPoint') {
      var sheet = ss.getSheetByName('จุดส่งสินค้า');
      sheet.appendRow([body.date || '', body.deliveryPoint || '', body.gate || '']);
      return jsonResponse({ ok: true, rowNumber: sheet.getLastRow() });
    }

    if (action === 'updateDeliveryPointGate') {
      var sheet = ss.getSheetByName('จุดส่งสินค้า');
      var rows = sheet.getDataRange().getValues();
      var pt = String(body.deliveryPoint || '').trim();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][1] || '').trim() === pt) {
          sheet.getRange(i + 1, 1, 1, 3).setValues([[
            body.updatedDate || rows[i][0],
            pt,
            String(body.newGate || '').trim()
          ]]);
          break;
        }
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'updateVehicleRegistration') {
      var sheet = ss.getSheetByName('ฐานข้อมูลรถ');
      var rows = sheet.getDataRange().getValues();
      var oldReg = String(body.oldRegistration || '').trim();
      var newReg = String(body.newRegistration || '').trim();
      var drv = String(body.driverName || '').trim();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || '').trim() === oldReg && (!drv || String(rows[i][8] || '').trim() === drv)) {
          sheet.getRange(i + 1, 1).setValue(newReg);
          break;
        }
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'updateVehicleField') {
      var sheet = ss.getSheetByName('ฐานข้อมูลรถ');
      var targetRow = (Number(body.rowNumber) || 0) + 1;
      var colId = String(body.colId || '').trim().toUpperCase();
      var colIndex = colId.charCodeAt(0) - 64;
      var valToSave = String(body.newValue || '').trim();
      if (valToSave.indexOf('data:image') === 0) {
        var driveUrl = saveBase64ImageToDrive(valToSave, 'vehicle_' + colId + '_row' + targetRow);
        valToSave = driveUrl || (valToSave.length <= 48000 ? valToSave : '');
      }
      if (targetRow >= 2 && colIndex >= 1 && colIndex <= 26) {
        sheet.getRange(targetRow, colIndex).setValue(valToSave);
      }
      return jsonResponse({ ok: true, value: valToSave });
    }

    if (action === 'updateJobTransferNote') {
      var sheet = ss.getSheetByName('บันทึกการย้ายงาน');
      var lastRow = sheet.getLastRow();
      var targetRow = Number(body.rowNumber) || 0;
      var startRow = Math.max(2, (targetRow || lastRow) - 150);
      var endRow = Math.min(lastRow, (targetRow || lastRow) + 150);
      if (endRow >= startRow) {
        var data = sheet.getRange(startRow, 1, endRow - startRow + 1, 9).getValues();
        for (var i = 0; i < data.length; i++) {
          if (
            String(data[i][2] || '').trim() === String(body.driverName || '').trim() &&
            String(data[i][3] || '').trim() === String(body.vehicleNumber || '').trim() &&
            String(data[i][8] || '').trim() === String(body.startTime || '').trim()
          ) {
            targetRow = startRow + i;
            break;
          }
        }
      }
      if (targetRow >= 2) {
        sheet.getRange(targetRow, 14).setValue(String(body.note || '').trim());
        sheet.getRange(targetRow, 18).setValue(String(body.note || '').trim());
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'appendRepairRequest') {
      var sheet = ss.getSheetByName('บันทึกงานซ่อม');
      var rowValues = body.rowValues || [];
      var photoUrls = [];
      for (var j = 0; j < 9; j++) {
        var val = rowValues[16 + j];
        if (val && typeof val === 'string' && val.indexOf('data:image') === 0) {
          var driveUrl = saveBase64ImageToDrive(val, 'repair_' + (rowValues[6] || rowValues[0] || 'photo') + '_' + (j + 1));
          var safeVal = driveUrl || (val.length <= 48000 ? val : '');
          rowValues[16 + j] = safeVal;
          photoUrls.push(safeVal);
        } else {
          photoUrls.push(val || '');
        }
      }
      sheet.appendRow(rowValues);
      var rowNumber = sheet.getLastRow();
      return jsonResponse({ ok: true, rowNumber: rowNumber, photoUrls: photoUrls });
    }

    if (action === 'approveRepairRequest') {
      var sheet = ss.getSheetByName('บันทึกงานซ่อม');
      var lastRow = sheet.getLastRow();
      var targetRow = Number(body.rowNumber) || 0;
      var sequenceNo = String(body.sequenceNo || '').trim();

      if (sequenceNo && lastRow >= 2) {
        var startRow = Math.max(2, lastRow - 300);
        var numRows = lastRow - startRow + 1;
        var seqData = sheet.getRange(startRow, 1, numRows, 1).getValues();
        for (var i = seqData.length - 1; i >= 0; i--) {
          if (String(seqData[i][0] || '').trim() === sequenceNo) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        if (body.inspectorName) sheet.getRange(targetRow, 28).setValue(String(body.inspectorName).trim());
        if (body.inspectionDate) sheet.getRange(targetRow, 29).setValue(String(body.inspectionDate).trim());
        if (body.inspectionTime) sheet.getRange(targetRow, 30).setValue(String(body.inspectionTime).trim());
        if (body.approverName) sheet.getRange(targetRow, 31).setValue(String(body.approverName).trim());
        if (body.approvalDate) sheet.getRange(targetRow, 32).setValue(String(body.approvalDate).trim());
        if (body.approvalTime) sheet.getRange(targetRow, 33).setValue(String(body.approvalTime).trim());
        if (body.note) sheet.getRange(targetRow, 34).setValue(String(body.note).trim());
        if (body.approvalStatus) sheet.getRange(targetRow, 35).setValue(String(body.approvalStatus).trim());
        if (body.repairStatus) sheet.getRange(targetRow, 16).setValue(String(body.repairStatus).trim());
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    if (action === 'inspectRepairRequest') {
      var sheet = ss.getSheetByName('บันทึกงานซ่อม');
      var lastRow = sheet.getLastRow();
      var targetRow = Number(body.rowNumber) || 0;
      var sequenceNo = String(body.sequenceNo || '').trim();
      var repairRequestNo = String(body.repairRequestNo || '').trim();

      if ((repairRequestNo || sequenceNo) && lastRow >= 2) {
        var startRow = Math.max(2, lastRow - 300);
        var numRows = lastRow - startRow + 1;
        var checkData = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (var i = checkData.length - 1; i >= 0; i--) {
          var rowSeq = String(checkData[i][0] || '').trim();
          var rowReqNo = String(checkData[i][6] || '').trim();
          if ((repairRequestNo && rowReqNo === repairRequestNo) || (sequenceNo && rowSeq === sequenceNo)) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        if (body.inspectorName) sheet.getRange(targetRow, 28).setValue(String(body.inspectorName).trim());
        if (body.inspectionDate) sheet.getRange(targetRow, 29).setValue(String(body.inspectionDate).trim());
        if (body.inspectionTime) sheet.getRange(targetRow, 30).setValue(String(body.inspectionTime).trim());
        sheet.getRange(targetRow, 16).setValue('ตรวจสอบแล้ว');
        sheet.getRange(targetRow, 35).setValue('2.⚠️รออนุมัติ');
        if (body.sparePartsCost !== undefined || body.laborCost !== undefined) {
          if (body.sparePartsCost !== undefined) sheet.getRange(targetRow, 14).setValue(String(body.sparePartsCost).trim());
          if (body.laborCost !== undefined) sheet.getRange(targetRow, 15).setValue(String(body.laborCost).trim());
        }
        if (body.note !== undefined && String(body.note).trim() !== '') {
          sheet.getRange(targetRow, 34).setValue(String(body.note).trim());
        }
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    if (action === 'updateRepairPhotos') {
      var sheet = ss.getSheetByName('บันทึกงานซ่อม');
      var lastRow = sheet.getLastRow();
      var targetRow = Number(body.rowNumber) || 0;
      var sequenceNo = String(body.sequenceNo || '').trim();
      var repairRequestNo = String(body.repairRequestNo || '').trim();

      if ((repairRequestNo || sequenceNo) && lastRow >= 2) {
        var startRow = 2;
        var numRows = lastRow - startRow + 1;
        var checkData = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (var i = checkData.length - 1; i >= 0; i--) {
          var rowSeq = String(checkData[i][0] || '').trim();
          var rowReqNo = String(checkData[i][6] || '').trim();
          if ((repairRequestNo && rowReqNo === repairRequestNo) || (sequenceNo && rowSeq === sequenceNo)) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      var photoUrls = [];
      if (targetRow >= 2 && Array.isArray(body.photos)) {
        var rowPhotos = [];
        for (var j = 0; j < 9; j++) {
          var p = body.photos[j];
          if (p !== undefined && p !== null && String(p).trim() !== '') {
            p = String(p).trim();
            if (p.indexOf('data:image') === 0) {
              var driveUrl = saveBase64ImageToDrive(p, 'repair_' + (repairRequestNo || sequenceNo || targetRow) + '_' + (j + 1));
              p = driveUrl || p;
            }
            rowPhotos.push(p);
            photoUrls.push(p);
          } else {
            rowPhotos.push('');
            photoUrls.push('');
          }
        }
        sheet.getRange(targetRow, 17, 1, 9).setValues([rowPhotos]);
      }
      return jsonResponse({ ok: true, rowNumber: targetRow, photoUrls: photoUrls });
    }

    if (action === 'updateRepairAdditionalDetails') {
      var sheet = ss.getSheetByName('บันทึกงานซ่อม');
      var lastRow = sheet.getLastRow();
      var targetRow = Number(body.rowNumber) || 0;
      var sequenceNo = String(body.sequenceNo || '').trim();
      var repairRequestNo = String(body.repairRequestNo || '').trim();

      if ((repairRequestNo || sequenceNo) && lastRow >= 2) {
        var startRow = Math.max(2, lastRow - 300);
        var numRows = lastRow - startRow + 1;
        var checkData = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (var i = checkData.length - 1; i >= 0; i--) {
          var rowSeq = String(checkData[i][0] || '').trim();
          var rowReqNo = String(checkData[i][6] || '').trim();
          if ((repairRequestNo && rowReqNo === repairRequestNo) || (sequenceNo && rowSeq === sequenceNo)) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        sheet.getRange(targetRow, 37).setValue(String(body.additionalDetails || '').trim());
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    if (action === 'updateRepairFinancialDetails') {
      var sheet = ss.getSheetByName('บันทึกงานซ่อม');
      var lastRow = sheet.getLastRow();
      var targetRow = Number(body.rowNumber) || 0;
      var sequenceNo = String(body.sequenceNo || '').trim();
      var repairRequestNo = String(body.repairRequestNo || '').trim();

      if ((repairRequestNo || sequenceNo) && lastRow >= 2) {
        var startRow = Math.max(2, lastRow - 300);
        var numRows = lastRow - startRow + 1;
        var checkData = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (var i = checkData.length - 1; i >= 0; i--) {
          var rowSeq = String(checkData[i][0] || '').trim();
          var rowReqNo = String(checkData[i][6] || '').trim();
          if ((repairRequestNo && rowReqNo === repairRequestNo) || (sequenceNo && rowSeq === sequenceNo)) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        sheet.getRange(targetRow, 14, 1, 2).setValues([[
          String(body.sparePartsCost || '').trim(),
          String(body.laborCost || '').trim()
        ]]);
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    if (action === 'updateRepairReplyDetails') {
      var sheet = ss.getSheetByName('บันทึกงานซ่อม');
      var lastRow = sheet.getLastRow();
      var targetRow = Number(body.rowNumber) || 0;
      var sequenceNo = String(body.sequenceNo || '').trim();
      var repairRequestNo = String(body.repairRequestNo || '').trim();

      if ((repairRequestNo || sequenceNo) && lastRow >= 2) {
        var startRow = Math.max(2, lastRow - 300);
        var numRows = lastRow - startRow + 1;
        var checkData = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (var i = checkData.length - 1; i >= 0; i--) {
          var rowSeq = String(checkData[i][0] || '').trim();
          var rowReqNo = String(checkData[i][6] || '').trim();
          if ((repairRequestNo && rowReqNo === repairRequestNo) || (sequenceNo && rowSeq === sequenceNo)) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        sheet.getRange(targetRow, 39).setValue(String(body.replyDetails || '').trim());
        if (body.replyDetails && String(body.replyDetails).trim() !== '') {
          sheet.getRange(targetRow, 35).setValue('4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว');
        }
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    if (action === 'appendFuelRecord') {
      var sheet = ss.getSheetByName('บันทึกน้ำมัน');
      if (sheet) {
        var rowValues = body.rowValues || [];
        sheet.appendRow(rowValues);
        var rowNumber = sheet.getLastRow();
        return jsonResponse({ ok: true, rowNumber: rowNumber });
      }
      return jsonResponse({ ok: false, error: 'Sheet บันทึกน้ำมัน not found' });
    }

    if (action === 'appendTrailerRecord') {
      var sheet = ss.getSheetByName('ฐานข้อมูลหาง');
      var trailerNo = String(body.trailerNumber || '').trim();
      if (sheet && trailerNo) {
        sheet.appendRow([trailerNo]);
        var rowNumber = sheet.getLastRow();
        return jsonResponse({ ok: true, rowNumber: rowNumber });
      }
      return jsonResponse({ ok: false, error: 'Sheet ฐานข้อมูลหาง not found or empty trailerNumber' });
    }

    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function searchImageInFolder_(folder, cleanName, prefixKey) {
  if (!folder) return null;
  try {
    var exact = folder.getFilesByName(cleanName);
    while (exact.hasNext()) {
      var f = exact.next();
      if ((f.getMimeType() || '').indexOf('image/') === 0) return f;
    }
  } catch (e) {}

  try {
    var normTarget = cleanName.normalize ? cleanName.normalize('NFC').toLowerCase() : cleanName.toLowerCase();
    var normPrefix = prefixKey ? (prefixKey.normalize ? prefixKey.normalize('NFC').toLowerCase() : prefixKey.toLowerCase()) : '';
    var files = folder.getFiles();
    var count = 0;
    var prefixMatch = null;
    while (files.hasNext() && count < 400) {
      count++;
      var file = files.next();
      var mime = file.getMimeType() || '';
      if (mime.indexOf('image/') !== 0) continue;
      var fname = file.getName() || '';
      var normName = fname.normalize ? fname.normalize('NFC').toLowerCase() : fname.toLowerCase();
      if (normName === normTarget) return file;
      if (normPrefix && normName.indexOf(normPrefix) === 0 && !prefixMatch) {
        prefixMatch = file;
      }
    }
    if (prefixMatch) return prefixMatch;
  } catch (e) {}
  return null;
}

function findAppSheetImageFile_(rawInput) {
  var raw = String(rawInput || '').trim();
  if (!raw) return null;

  var folderName = '';
  var cleanName = raw;
  if (raw.indexOf('/') >= 0) {
    var parts = raw.split('/');
    folderName = parts[0].trim();
    cleanName = parts[parts.length - 1].trim();
  }

  // Extract key prefix before AppSheet timestamp (e.g. "FL-1.รูปรถ." or "TMT2026-10-0035.รูปถ่ายที่1.")
  var prefixKey = '';
  var dotParts = cleanName.split('.');
  if (dotParts.length >= 3) {
    prefixKey = dotParts.slice(0, dotParts.length - 2).join('.') + '.';
  }

  var file = null;

  // 1. Check main maintenance image folder
  try {
    var targetFolder = DriveApp.getFolderById('1y9_CzTkunm85vparUxDGg_lvCH0sa6P0');
    file = searchImageInFolder_(targetFolder, cleanName, prefixKey);
    if (file) return file;
  } catch (e) {}

  // 2. Check parent folder(s) of the Google Sheet for AppSheet subfolder (e.g. ฐานข้อมูลรถ_Images, Account_Images, บันทึกงานซ่อม_Images)
  try {
    var ssFile = DriveApp.getFileById('${GOOGLE_SHEET_ID}');
    var parents = ssFile.getParents();
    while (parents.hasNext()) {
      var parent = parents.next();
      if (folderName) {
        var subFolders = parent.getFoldersByName(folderName);
        while (subFolders.hasNext()) {
          file = searchImageInFolder_(subFolders.next(), cleanName, prefixKey);
          if (file) return file;
        }
      }
      file = searchImageInFolder_(parent, cleanName, prefixKey);
      if (file) return file;
    }
  } catch (e) {}

  // 3. Search any folder in Drive matching folderName (e.g. inside /appsheet/data/...)
  if (folderName) {
    try {
      var matchingFolders = DriveApp.getFoldersByName(folderName);
      var fCount = 0;
      while (matchingFolders.hasNext() && fCount < 10) {
        fCount++;
        file = searchImageInFolder_(matchingFolders.next(), cleanName, prefixKey);
        if (file) return file;
      }
    } catch (e) {}
  }

  // 4. Global exact filename match (images only)
  try {
    var allFiles = DriveApp.getFilesByName(cleanName);
    while (allFiles.hasNext()) {
      var candidate = allFiles.next();
      if ((candidate.getMimeType() || '').indexOf('image/') === 0) {
        return candidate;
      }
    }
  } catch (e) {}

  // 5. Fallback Drive search by prefixKey or cleanName
  try {
    var searchTerm = (prefixKey || cleanName).replace(/'/g, "\\\\'");
    var searched = DriveApp.searchFiles("title contains '" + searchTerm + "' and mimeType contains 'image/' and trashed = false");
    if (searched.hasNext()) {
      return searched.next();
    }
  } catch (e) {}

  return null;
}

function doGet(e) {
  try {
    var fileIdParam = (e && e.parameter && e.parameter.fileId) || '';
    var filename = (e && e.parameter && (e.parameter.filename || e.parameter.file || e.parameter.path)) || '';
    var file = null;

    if (fileIdParam) {
      try {
        file = DriveApp.getFileById(String(fileIdParam).trim());
      } catch (idErr) {}
    }

    if (!file && filename) {
      file = findAppSheetImageFile_(filename);
    }

    if (!file) {
      return jsonResponse({
        success: false,
        message: 'ไม่พบรูปภาพใน Google Drive: ' + (filename || fileIdParam)
      });
    }

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {}

    var blob = file.getBlob();
    var base64 = Utilities.base64Encode(blob.getBytes());
    return jsonResponse({
      success: true,
      fileId: file.getId(),
      url: 'https://lh3.googleusercontent.com/d/' + file.getId(),
      mimeType: blob.getContentType() || 'image/jpeg',
      base64: base64
    });
  } catch (err) {
    return jsonResponse({ success: false, message: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;

export const DRIVE_FOLDER_ID = '1y9_CzTkunm85vparUxDGg_lvCH0sa6P0';

const DRIVE_PHOTO_STORAGE_KEY = 'gsheets_drive_photo_cache_v2';
const resolvedDriveImageCache = new Map<string, string>();
const failedDriveImageCache = new Map<string, number>();
const pendingDriveImagePromises = new Map<string, Promise<string | null>>();

// Hydrate persistent Drive URL cache (only lightweight URLs, not large base64 strings)
try {
  const rawCache = localStorage.getItem(DRIVE_PHOTO_STORAGE_KEY);
  if (rawCache) {
    const parsed = JSON.parse(rawCache) as Record<string, string>;
    Object.entries(parsed).forEach(([k, v]) => {
      if (k && typeof v === 'string' && v.startsWith('http')) {
        resolvedDriveImageCache.set(k, v);
      }
    });
  }
} catch {
  // ignore storage errors
}

function persistResolvedDriveUrl(key: string, url: string): void {
  if (!key || !url.startsWith('http')) return;
  try {
    const rawCache = localStorage.getItem(DRIVE_PHOTO_STORAGE_KEY);
    const parsed: Record<string, string> = rawCache ? JSON.parse(rawCache) : {};
    parsed[key] = url;
    const keys = Object.keys(parsed);
    if (keys.length > 500) {
      delete parsed[keys[0]];
    }
    localStorage.setItem(DRIVE_PHOTO_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore storage errors
  }
}

export function clearFailedDriveImageCache(): void {
  failedDriveImageCache.clear();
}

export function extractDriveFileId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const lh3Match = trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (lh3Match) return lh3Match[1];
  const fileDMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileDMatch) return fileDMatch[1];
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  const openMatch = trimmed.match(/open\?id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];
  return null;
}

export function isLegacyAppSheetPhotoPath(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === '-') return false;
  if (trimmed.startsWith('data:image/')) return false;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return false;
  return (
    trimmed.includes('_Images/') ||
    /\.(jpg|jpeg|png|webp|gif)$/i.test(trimmed)
  );
}

export function isPhotoValue(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === '-') return false;
  return (
    trimmed.startsWith('data:image/') ||
    Boolean(extractDriveFileId(trimmed)) ||
    isLegacyAppSheetPhotoPath(trimmed) ||
    (trimmed.startsWith('http') && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(trimmed))
  );
}

export function formatDriveImageUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  if (resolvedDriveImageCache.has(trimmed)) {
    return resolvedDriveImageCache.get(trimmed)!;
  }
  const fileId = extractDriveFileId(trimmed);
  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }
  return trimmed;
}

export function getDriveThumbnailUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  if (resolvedDriveImageCache.has(trimmed)) {
    const cached = resolvedDriveImageCache.get(trimmed)!;
    const cachedFileId = extractDriveFileId(cached);
    if (cachedFileId) {
      return `https://drive.google.com/thumbnail?id=${cachedFileId}&sz=w1000`;
    }
    return cached;
  }
  const fileId = extractDriveFileId(trimmed);
  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  }
  return trimmed;
}

// Concurrency limiter for Apps Script photo resolution so mounting 30+ rows doesn't flood Google Apps Script
const MAX_CONCURRENT_DRIVE_RESOLVES = 3;
let activeDriveResolves = 0;
const driveResolveQueue: Array<() => void> = [];

function runWithDriveResolveLimiter<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const execute = () => {
      activeDriveResolves++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeDriveResolves--;
          const next = driveResolveQueue.shift();
          if (next) next();
        });
    };
    if (activeDriveResolves < MAX_CONCURRENT_DRIVE_RESOLVES) {
      execute();
    } else {
      driveResolveQueue.push(execute);
    }
  });
}

export async function resolveDriveImageSrc(
  rawUrl: string,
  forceAppsScriptLookup = false
): Promise<string | null> {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === '-') return null;

  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  if (!forceAppsScriptLookup && resolvedDriveImageCache.has(trimmed)) {
    return resolvedDriveImageCache.get(trimmed)!;
  }

  const directFileId = extractDriveFileId(trimmed);
  if (directFileId && !forceAppsScriptLookup) {
    const formatted = `https://lh3.googleusercontent.com/d/${directFileId}`;
    resolvedDriveImageCache.set(trimmed, formatted);
    return formatted;
  }

  if (!directFileId && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
    return trimmed;
  }

  const failedAt = failedDriveImageCache.get(trimmed);
  if (failedAt && Date.now() - failedAt < 45_000) {
    return null;
  }

  const pendingKey = `${trimmed}::${forceAppsScriptLookup ? 'force' : 'normal'}`;
  if (pendingDriveImagePromises.has(pendingKey)) {
    return pendingDriveImagePromises.get(pendingKey)!;
  }

  const promise = runWithDriveResolveLimiter(async (): Promise<string | null> => {
    try {
      const scriptUrl = getConfiguredAppsScriptUrl();
      const queryParam = directFileId
        ? `fileId=${encodeURIComponent(directFileId)}`
        : `filename=${encodeURIComponent(trimmed)}`;

      const parsePhotoPayload = (data: {
        success?: boolean;
        ok?: boolean;
        base64?: string;
        mimeType?: string;
        fileId?: string;
        url?: string;
      }): string | null => {
        if (data.base64) {
          const mime = data.mimeType || 'image/jpeg';
          const dataUrl = data.base64.startsWith('data:image/')
            ? data.base64
            : `data:${mime};base64,${data.base64}`;
          resolvedDriveImageCache.set(trimmed, dataUrl);
          if (data.fileId) {
            persistResolvedDriveUrl(trimmed, `https://lh3.googleusercontent.com/d/${data.fileId}`);
          }
          return dataUrl;
        }
        if (data.fileId) {
          const driveUrl = `https://lh3.googleusercontent.com/d/${data.fileId}`;
          resolvedDriveImageCache.set(trimmed, driveUrl);
          persistResolvedDriveUrl(trimmed, driveUrl);
          return driveUrl;
        }
        if (data.url) {
          const formattedUrl = formatDriveImageUrl(data.url);
          resolvedDriveImageCache.set(trimmed, formattedUrl);
          persistResolvedDriveUrl(trimmed, formattedUrl);
          return formattedUrl;
        }
        return null;
      };

      // 1. Try backend proxy first to avoid browser CORS errors on Apps Script redirects
      if (isBackendApiAvailable !== false && !directFileId) {
        try {
          const proxyResPromise = safeBackendFetch(
            `/api/drive-photo?filename=${encodeURIComponent(trimmed)}&scriptUrl=${encodeURIComponent(scriptUrl || '')}`
          );
          if (proxyResPromise) {
            const proxyRes = await proxyResPromise;
            if (proxyRes.ok) {
              const proxyData = await proxyRes.json();
              const resolved = parsePhotoPayload(proxyData);
              if (resolved) return resolved;
              // If backend proxy explicitly returned a JSON miss from Apps Script, don't duplicate the call from browser
              if (proxyData && proxyData.success === false) {
                failedDriveImageCache.set(trimmed, Date.now());
                return null;
              }
            }
          }
        } catch {
          // fall through to direct fetch
        }
      }

      // 2. Fallback to direct browser fetch to Apps Script URL
      if (scriptUrl) {
        try {
          const sep = scriptUrl.includes('?') ? '&' : '?';
          const reqUrl = `${scriptUrl}${sep}${queryParam}`;
          const res = await fetch(reqUrl);
          if (res.ok) {
            const data = await res.json();
            const resolved = parsePhotoPayload(data);
            if (resolved) return resolved;
          }
        } catch {
          // ignore
        }
      }

      failedDriveImageCache.set(trimmed, Date.now());
      return null;
    } finally {
      pendingDriveImagePromises.delete(pendingKey);
    }
  });

  pendingDriveImagePromises.set(pendingKey, promise);
  return promise;
}

let lastWebhookError: string | null = null;

export function getLastWebhookError(): string | null {
  return lastWebhookError;
}

async function executeAppsScriptWebhookForUrl(
  targetUrl: string,
  payload: Record<string, unknown>
): Promise<{
  ok?: boolean;
  rowNumber?: number | null;
  error?: string;
  photoUrls?: string[];
}> {
  // 1. Primary Attempt: Call Serverless Proxy (/api/webhook-proxy) first to avoid browser CORS limits
  if (isBackendApiAvailable !== false) {
    try {
      const proxyRes = await fetch('/api/webhook-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptUrl: targetUrl, payload }),
      });

      if (proxyRes.ok) {
        const pData = (await proxyRes.json()) as {
          ok?: boolean;
          rowNumber?: number | null;
          error?: string;
          photoUrls?: string[];
          rawText?: string;
        };
        if (pData && pData.ok === true && !pData.rawText) {
          lastWebhookError = null;
          return pData;
        }
        if (pData && pData.error) {
          lastWebhookError = pData.error;
        }
      } else if (proxyRes.status === 404) {
        isBackendApiAvailable = false;
      }
    } catch {
      // proxy unavailable or network error, fall through to direct fetch
    }
  }

  // 2. Secondary Attempt: Direct fetch from browser using simple request (text/plain) & redirect: 'follow'
  // CRITICAL: NEVER use 'application/json' to prevent CORS preflight OPTIONS rejection.
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });

  if (!response.ok) {
    if (response.status === 404) {
      lastWebhookError = 'ไม่พบ Webhook URL นี้ใน Google Apps Script (HTTP 404 - กรุณาตรวจสอบ URL ในเมนูเชื่อมต่อ Google Sheet)';
    } else if (response.status === 401 || response.status === 403) {
      lastWebhookError = 'สิทธิ์เข้าถึง Apps Script ไม่ถูกต้อง (HTTP 403 - กรุณาตั้งค่า Who has access เป็น Anyone ใน Apps Script)';
    } else {
      lastWebhookError = `Apps Script HTTP ${response.status}`;
    }
    throw new Error(lastWebhookError);
  }

  const rawText = await response.text();
  let data: {
    ok?: boolean;
    rowNumber?: number | null;
    error?: string;
    photoUrls?: string[];
  };

  try {
    data = JSON.parse(rawText) as {
      ok?: boolean;
      rowNumber?: number | null;
      error?: string;
      photoUrls?: string[];
    };
  } catch {
    const htmlErrMatch = rawText.match(/font-family:monospace[^>]*>([^<]+)</i);
    let extractedErr = htmlErrMatch?.[1]
      ? htmlErrMatch[1]
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .trim()
      : '';

    if (rawText.includes('You do not have permission') || extractedErr.includes('permission')) {
      extractedErr = 'สิทธิ์เข้าถึง Apps Script ไม่ถูกต้อง: กรุณาเข้าไปที่ Apps Script -> การทำให้ใช้งานได้ (Deploy) -> จัดการการทำให้ใช้งานได้ -> แก้ไข และเลือก "ผู้มีสิทธิ์เข้าถึง (Who has access)" เป็น "ทุกคน (Anyone)"';
    } else if (rawText.includes('Sorry, unable to open the file') || rawText.includes('Page not found')) {
      extractedErr = 'Webhook URL เดิมไม่ถูกต้องหรือถูกลบไปแล้ว กรุณาอัปเดต Webhook URL ใหม่ในเมนูเชื่อมต่อ Google Sheet';
    } else if (!extractedErr) {
      extractedErr = 'Apps Script ไม่ได้ส่งค่ากลับเป็น JSON (กรุณาตรวจสอบโค้ดและ Deploy เวอร์ชันใหม่)';
    }

    lastWebhookError = extractedErr;
    throw new Error(extractedErr);
  }

  if (data.ok === false) {
    lastWebhookError = data.error || 'Apps Script เกิดข้อผิดพลาดในการทำงาน';
    throw new Error(lastWebhookError);
  }

  lastWebhookError = null;
  return data;
}

async function callAppsScriptWebhook(
  scriptUrl: string,
  payload: Record<string, unknown>
): Promise<{
  ok?: boolean;
  rowNumber?: number | null;
  error?: string;
  photoUrls?: string[];
}> {
  const targetUrl = normalizeAppsScriptUrl(scriptUrl);
  try {
    return await executeAppsScriptWebhookForUrl(targetUrl, payload);
  } catch (err) {
    if (targetUrl !== DEFAULT_APPS_SCRIPT_URL) {
      const res = await executeAppsScriptWebhookForUrl(DEFAULT_APPS_SCRIPT_URL, payload);
      configuredAppsScriptUrl = DEFAULT_APPS_SCRIPT_URL;
      try {
        localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, DEFAULT_APPS_SCRIPT_URL);
      } catch {
        // ignore
      }
      return res;
    }
    throw err;
  }
}

// Auto-discover Apps Script URL and backend cached token on startup (non-blocking)
void (async () => {
  if (isBackendApiAvailable === false) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    const tokenPromise = safeBackendFetch('/api/google-token', { signal: ctrl.signal });
    const scriptPromise = safeBackendFetch('/api/script-url', { signal: ctrl.signal });
    if (!tokenPromise || !scriptPromise) {
      clearTimeout(timer);
      return;
    }
    const [tokenRes, scriptRes] = await Promise.allSettled([tokenPromise, scriptPromise]);
    clearTimeout(timer);

    if (tokenRes.status === 'fulfilled' && tokenRes.value.ok) {
      const data = (await tokenRes.value.json()) as {
        accessToken?: string | null;
        expiresAt?: number;
      };
      if (
        data.accessToken &&
        data.expiresAt &&
        data.expiresAt > Date.now() + 30000
      ) {
        cachedAccessToken = data.accessToken;
        cachedTokenExpiresAt = data.expiresAt;
      }
    }

    if (scriptRes.status === 'fulfilled' && scriptRes.value.ok) {
      const sData = (await scriptRes.value.json()) as {
        scriptUrl?: string | null;
      };
      if (
        sData.scriptUrl &&
        sData.scriptUrl.startsWith('https://script.google.com/')
      ) {
        const norm = normalizeAppsScriptUrl(sData.scriptUrl);
        if (
          !configuredAppsScriptUrl ||
          configuredAppsScriptUrl.includes('/dev') ||
          configuredAppsScriptUrl.includes(STALE_APPS_SCRIPT_ID) ||
          configuredAppsScriptUrl === DEFAULT_APPS_SCRIPT_URL
        ) {
          configuredAppsScriptUrl = norm;
          try {
            localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, norm);
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore on static hosting
  }

  // Also check cell D1 of จุดส่งสินค้า (gid: 1156877149) for auto-discovered Apps Script URL
  try {
    const gviz = await queryGviz('1156877149', 'select D limit 1');
    const colLabel = gviz.table?.cols?.[0]?.label?.trim() ?? '';
    const firstCell = String(gviz.table?.rows?.[0]?.c?.[0]?.v ?? '').trim();
    const candidate = colLabel.startsWith('https://script.google.com/')
      ? colLabel
      : firstCell.startsWith('https://script.google.com/')
        ? firstCell
        : '';
    if (candidate) {
      const norm = normalizeAppsScriptUrl(candidate);
      if (
        !configuredAppsScriptUrl ||
        configuredAppsScriptUrl.includes('/dev') ||
        configuredAppsScriptUrl.includes(STALE_APPS_SCRIPT_ID) ||
        configuredAppsScriptUrl === DEFAULT_APPS_SCRIPT_URL
      ) {
        configuredAppsScriptUrl = norm;
        try {
          localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, norm);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  if (configuredAppsScriptUrl || cachedAccessToken) {
    void flushPendingMutationsToGoogleSheet();
  }
})();

export async function connectAdminGoogleAccountOnce(): Promise<string> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('ไม่สามารถรับสิทธิ์เชื่อมต่อ Google Sheets ได้');
    }
    cachedAccessToken = credential.accessToken;
    cachedTokenExpiresAt = Date.now() + 3500 * 1000;
    if (isBackendApiAvailable !== false) {
      void safeBackendFetch('/api/google-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: credential.accessToken,
          expiresInSec: 3500,
        }),
      })?.catch(() => {});
    }
    void flushPendingMutationsToGoogleSheet();
    return credential.accessToken;
  } finally {
    isSigningIn = false;
  }
}

function getSilentAccessToken(): string | null {
  if (cachedAccessToken && cachedTokenExpiresAt > Date.now() + 30000) {
    return cachedAccessToken;
  }
  return null;
}

async function getOrConnectAccessToken(_allowPopup = false): Promise<string | null> {
  const silent = getSilentAccessToken();
  if (silent) return silent;

  if (isBackendApiAvailable !== false) {
    try {
      const tokenPromise = safeBackendFetch('/api/google-token');
      if (tokenPromise) {
        const res = await tokenPromise;
        if (res.ok) {
          const data = (await res.json()) as {
            accessToken?: string | null;
            expiresAt?: number;
          };
          if (data.accessToken && data.expiresAt && data.expiresAt > Date.now() + 30000) {
            cachedAccessToken = data.accessToken;
            cachedTokenExpiresAt = data.expiresAt;
            return cachedAccessToken;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function invalidateCachedToken(): void {
  cachedAccessToken = null;
  cachedTokenExpiresAt = 0;
}

export const SHEET_TABS: SheetTabConfig[] = [
  {
    gid: '606634465',
    name: 'บันทึกการย้ายงาน',
    category: 'งานขนส่ง',
    description: 'รายการเคลื่อนย้ายสินค้าภายในโรงงานแบบเรียลไทม์',
    reverseOrder: true,
    defaultLimit: 250,
  },
  {
    gid: '944294225',
    name: 'บันทึกงานซ่อม',
    category: 'งานซ่อมบำรุง',
    description: 'รายการแจ้งซ่อม สถานะคิวซ่อม และการอนุมัติงานซ่อมบำรุง',
    reverseOrder: true,
    defaultLimit: 250,
  },
  {
    gid: '378250263',
    name: 'ฐานข้อมูลรถ',
    category: 'ทะเบียนรถ',
    description: 'ข้อมูลรถโฟร์คลิฟท์ รถหัวลาก พนักงานประจำรถ และพื้นที่ปฏิบัติงาน',
    reverseOrder: false,
    defaultLimit: 200,
  },
  {
    gid: '1733355146',
    name: 'บันทึกน้ำมัน',
    category: 'เชื้อเพลิง',
    description: 'ประวัติการรับเข้าและเบิกจ่ายน้ำมันเชื้อเพลิง ดีเซล/เบนซิน',
    reverseOrder: true,
    defaultLimit: 250,
  },
  {
    gid: '1031154414',
    name: 'STOCK ยาง',
    category: 'คลังอะไหล่',
    description: 'รายการสต็อกยางนอก ยางใน ยอดรับเข้า เบิกออก และคงเหลือ',
    reverseOrder: false,
    defaultLimit: 200,
  },
  {
    gid: '1032541508',
    name: 'กำหนดรอบPM',
    category: 'งานซ่อมบำรุง',
    description: 'ตารางติดตามเลขไมล์และสถานะครบรอบการบำรุงรักษาเชิงป้องกัน (PM)',
    reverseOrder: false,
    defaultLimit: 200,
  },
  {
    gid: '1156877149',
    name: 'จุดส่งสินค้า',
    category: 'งานขนส่ง',
    description: 'ข้อมูลจุดส่งสินค้าและประตูเข้า-ออกประจำวัน',
    reverseOrder: false,
    defaultLimit: 200,
  },
  {
    gid: '1295975917',
    name: 'ฐานข้อมูลหาง',
    category: 'ทะเบียนรถ',
    description: 'รายการหมายเลขหางพ่วงทั้งหมดในระบบ',
    reverseOrder: false,
    defaultLimit: 200,
  },
];

const FALLBACK_COLUMN_LABELS: Record<string, Record<string, string>> = {
  '606634465': {
    R: 'หมายเหตุ',
    U: 'น้ำหนักสุทธิ',
    V: 'จำนวนรอบ',
  },
  '944294225': {
    A: 'ลำดับ',
    B: 'วันที่แจ้งซ่อม',
    C: 'เวลาแจ้งซ่อม',
    D: 'เบอร์รถ',
    E: 'ประเภทการซ่อม',
    F: 'อาการเสีย',
    G: 'เลขที่ขอซ่อม',
    H: 'เลขที่แจ้งซ่อม SAP',
    I: 'กำหนดการ',
    J: 'วันที่ซ่อมเสร็จ',
    K: 'ระยะเวลาซ่อม',
    L: 'เลขที่ PR',
    M: 'เลขที่ใบกำกับภาษี',
    N: 'ค่าอะไหล่',
    O: 'ค่าแรง',
    P: 'สถานะ',
    Q: 'รูปถ่ายที่ 1',
    R: 'รูปถ่ายที่ 2',
    S: 'รูปถ่ายที่ 3',
    T: 'รูปถ่ายที่ 4',
    U: 'รูปถ่ายที่ 5',
    V: 'รูปถ่ายที่ 6',
    W: 'รูปถ่ายที่ 7',
    X: 'รูปถ่ายที่ 8',
    Y: 'รูปถ่ายที่ 9',
    Z: 'ใบกำกับภาษี',
    AA: 'ผู้แจ้งซ่อม',
    AB: 'ผู้ตรวจสอบ',
    AC: 'วันที่ตรวจสอบ',
    AD: 'เวลาตรวจสอบ',
    AE: 'ผู้อนุมัติ',
    AF: 'วันที่อนุมัติ',
    AG: 'เวลาอนุมัติ',
    AH: 'หมายเหตุ',
    AI: 'สถานะการอนุมัติ',
    AJ: 'ID',
    AK: 'รายละเอียดเพิ่มเติม',
    AL: 'สถานะการเปลี่ยนแปลง',
    AM: 'ตอบกลับข้อมูลเพิ่มเติม',
  },
  '378250263': {
    A: 'ทะเบียนรถ',
    B: 'รูปรถ',
    C: 'ประเภทรถ',
    D: 'รุ่น',
    E: 'พิกัด',
    F: 'การใช้งาน',
    G: 'สถานะการใช้งาน',
    H: 'หมายเหตุ',
    I: 'ชื่อพนักงานประจำรถ',
    J: 'พื้นที่ปฎิบัติงาน',
    K: 'หมายเลขโทรศัพท์',
    L: 'กะทำงาน',
    M: 'รูปพนักงาน',
    N: 'เวลาเลิกงาน',
    O: 'ทีม',
    P: 'รหัสพนักงาน',
  },
  '1295975917': {
    A: 'หมายเลขหางพ่วง',
  },
};

const HIDDEN_COLUMN_IDS: Record<string, Set<string>> = {
  '606634465': new Set(['P', 'Q', 'R', 'S', 'T', 'U', 'V']),
  '1156877149': new Set(['D', 'Z']),
  '944294225': new Set([
    'A', 'B', 'C', 'G',
    'H', 'I', 'J', 'K', 'L', 'M',
    'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y',
    'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH',
    'AJ', 'AK', 'AL', 'AM',
  ]),
};

const HIDDEN_COLUMN_LABELS: Record<string, Set<string>> = {
  '606634465': new Set([
    'วันเวลาทำรายการ',
    'รหัสรายการ',
    'ภาพถ่ายที่ 1',
    'ภาพถ่ายที่ 2',
    'น้ำหนักสุทธิ',
    'จำนวนรอบ',
  ]),
  '944294225': new Set([
    'ลำดับ',
    'วันที่แจ้งซ่อม',
    'เวลาแจ้งซ่อม',
    'เวลาแจงซ่อม',
    'เลขที่ขอซ่อม',
    'เลขที่แจ้งซ่อม SAP',
    'เลขที่แจ้งซ่อมSAP',
    'กำหนดการ',
    'วันที่ซ่อมเสร็จ',
    'ระยะเวลาซ่อม',
    'เลขที่ PR',
    'เลขที่PR',
    'เลขที่ใบกำกับภาษี',
    'รูปถ่ายที่ 2',
    'รูปถ่ายที่ 3',
    'รูปถ่ายที่ 4',
    'รูปถ่ายที่ 5',
    'รูปถ่ายที่ 6',
    'รูปถ่ายที่ 7',
    'รูปถ่ายที่ 8',
    'รูปถ่ายที่ 9',
    'ภาพถ่ายที่ 2',
    'ภาพถ่ายที่ 3',
    'ภาพถ่ายที่ 4',
    'ภาพถ่ายที่ 5',
    'ภาพถ่ายที่ 6',
    'ภาพถ่ายที่ 7',
    'ภาพถ่ายที่ 8',
    'ภาพถ่ายที่ 9',
    'ใบกำกับภาษี',
    'ผู้แจ้งซ่อม',
    'ผู้ตรวจสอบ',
    'วันที่ตรวจสอบ',
    'เวลาตรวจสอบ',
    'ผู้อนุมัติ',
    'วันที่อนุมัติ',
    'เวลาอนุมัติ',
    'หมายเหตุ',
    'ID',
    'id',
    'Id',
    'สถานะการเปลี่ยนแปลง',
    'รายละเอียดเพิ่มเติม',
    'ตอบกลับข้อมูลเพิ่มเติม',
  ]),
};

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
  syncedToSheet?: boolean;
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
  syncedToSheet?: boolean;
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
}

function createEmptyMutationsStore(): MutationsStore {
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

function isRecentOptimisticMutation(updatedAt?: string, maxAgeMs = 20000): boolean {
  if (!updatedAt) return false;
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= maxAgeMs;
}

function readLocalMutationsStore(): MutationsStore {
  try {
    localStorage.removeItem('gsheets_local_mutations_v1');
    localStorage.removeItem('gsheets_local_mutations_v2');
    localStorage.removeItem('gsheets_row_count_944294225');
    const raw = localStorage.getItem(LOCAL_MUTATIONS_STORAGE_KEY);
    if (!raw) return createEmptyMutationsStore();
    const parsed = JSON.parse(raw) as Partial<MutationsStore>;
    const rawJobTransfers = Array.isArray(parsed.jobTransfers) ? parsed.jobTransfers : [];
    const rawRepairRequests = Array.isArray(parsed.repairRequests) ? parsed.repairRequests : [];
    const rawRepairApprovals = Array.isArray(parsed.repairApprovals) ? parsed.repairApprovals : [];
    const rawRepairInspections = Array.isArray(parsed.repairInspections) ? parsed.repairInspections : [];
    const rawRepairPhotoEdits = Array.isArray(parsed.repairPhotoEdits) ? parsed.repairPhotoEdits : [];
    const rawRepairDetailEdits = Array.isArray(parsed.repairDetailEdits) ? parsed.repairDetailEdits : [];
    const rawRepairReplyEdits = Array.isArray(parsed.repairReplyEdits) ? parsed.repairReplyEdits : [];
    const rawRepairFinancialEdits = Array.isArray(parsed.repairFinancialEdits) ? parsed.repairFinancialEdits : [];

    // Only retain recent optimistic items in local store while Google Sheets GViz cache refreshes.
    const jobTransfers = rawJobTransfers.filter((jt) => !jt.syncedToSheet);
    const repairRequests = rawRepairRequests.filter((rr) =>
      isRecentOptimisticMutation(rr.createdAt)
    );
    const repairApprovals = rawRepairApprovals.filter((ra) =>
      isRecentOptimisticMutation(ra.updatedAt)
    );
    const repairInspections = rawRepairInspections.filter((ri) =>
      isRecentOptimisticMutation(ri.updatedAt)
    );
    const repairPhotoEdits = rawRepairPhotoEdits.filter((pe) =>
      isRecentOptimisticMutation(pe.updatedAt)
    );
    const repairDetailEdits = rawRepairDetailEdits.filter((de) =>
      isRecentOptimisticMutation(de.updatedAt)
    );
    const repairReplyEdits = rawRepairReplyEdits.filter((re) =>
      isRecentOptimisticMutation(re.updatedAt)
    );
    const repairFinancialEdits = rawRepairFinancialEdits.filter((fe) =>
      isRecentOptimisticMutation(fe.updatedAt)
    );

    return {
      jobTransfers,
      deliveryPoints: Array.isArray(parsed.deliveryPoints)
        ? parsed.deliveryPoints
        : [],
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
      repairRequests,
      repairApprovals,
      repairInspections,
      repairPhotoEdits,
      repairDetailEdits,
      repairReplyEdits,
      repairFinancialEdits,
      fuelRecords: Array.isArray(parsed.fuelRecords)
        ? parsed.fuelRecords
        : [],
    };
  } catch {
    return createEmptyMutationsStore();
  }
}

function writeLocalMutationsStore(store: MutationsStore): void {
  try {
    localStorage.setItem(LOCAL_MUTATIONS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    try {
      const compactStore: MutationsStore = {
        ...store,
        repairRequests: store.repairRequests.map((r) => {
          const cleanValues: Record<string, string> = {};
          Object.entries(r.values).forEach(([k, v]) => {
            cleanValues[k] = v && v.length > 48000 ? '' : v;
          });
          return { ...r, values: cleanValues };
        }),
        repairPhotoEdits: store.repairPhotoEdits.map((p) => ({
          ...p,
          photos: p.photos.map((ph) => (ph && ph.length > 48000 ? '' : ph)),
        })),
      };
      localStorage.setItem(LOCAL_MUTATIONS_STORAGE_KEY, JSON.stringify(compactStore));
    } catch {
      // ignore storage errors
    }
  }
}

async function fetchCombinedMutationsStore(
  signal?: AbortSignal
): Promise<MutationsStore> {
  const local = readLocalMutationsStore();
  if (isBackendApiAvailable === false) {
    return local;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    const combinedSignal = signal
      ? AbortSignal.any
        ? AbortSignal.any([signal, ctrl.signal])
        : ctrl.signal
      : ctrl.signal;
    const fetchPromise = safeBackendFetch('/api/mutations', {
      signal: combinedSignal,
      headers: { Accept: 'application/json' },
    });
    if (!fetchPromise) {
      clearTimeout(timer);
      return local;
    }
    const res = await fetchPromise;
    clearTimeout(timer);
    if (!res.ok || res.status === 404) {
      isBackendApiAvailable = false;
      return local;
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      isBackendApiAvailable = false;
      return local;
    }
    const remote = (await res.json()) as Partial<MutationsStore>;
      const mergedJobMap = new Map<string, StoredJobTransfer>();
      (remote.jobTransfers ?? []).forEach((jt) => mergedJobMap.set(jt.recordId, jt));
      local.jobTransfers.forEach((jt) => {
        const existing = mergedJobMap.get(jt.recordId);
        mergedJobMap.set(
          jt.recordId,
          existing
            ? {
                ...existing,
                ...jt,
                syncedToSheet: Boolean(existing.syncedToSheet || jt.syncedToSheet),
                values: { ...existing.values, ...jt.values },
              }
            : jt
        );
      });

      const mergedDpMap = new Map<string, StoredDeliveryPoint>();
      (remote.deliveryPoints ?? []).forEach((dp) => mergedDpMap.set(dp.id, dp));
      local.deliveryPoints.forEach((dp) => mergedDpMap.set(dp.id, dp));

      const mergedDpEditMap = new Map<string, StoredDeliveryPointEdit>();
      (remote.deliveryPointEdits ?? []).forEach((e) =>
        mergedDpEditMap.set(e.deliveryPoint, e)
      );
      local.deliveryPointEdits.forEach((e) =>
        mergedDpEditMap.set(e.deliveryPoint, e)
      );

      const mergedVehEdits = [
        ...(remote.vehicleRegEdits ?? []),
        ...local.vehicleRegEdits.filter(
          (l) =>
            !(remote.vehicleRegEdits ?? []).some(
              (r) =>
                r.oldRegistration === l.oldRegistration &&
                r.newRegistration === l.newRegistration
            )
        ),
      ];

      const mergedNoteMap = new Map<string, StoredJobTransferNoteEdit>();
      (remote.jobTransferNoteEdits ?? []).forEach((e) =>
        mergedNoteMap.set(`${e.date}|${e.driverName}|${e.vehicleNumber}|${e.startTime}`, e)
      );
      local.jobTransferNoteEdits.forEach((e) =>
        mergedNoteMap.set(`${e.date}|${e.driverName}|${e.vehicleNumber}|${e.startTime}`, e)
      );

      const mergedRepReqMap = new Map<string, StoredRepairRequest>();
      (remote.repairRequests ?? [])
        .filter((r) => isRecentOptimisticMutation(r.createdAt))
        .forEach((r) => mergedRepReqMap.set(r.id, r));
      local.repairRequests.forEach((r) => {
        const existing = mergedRepReqMap.get(r.id);
        mergedRepReqMap.set(
          r.id,
          existing
            ? {
                ...existing,
                ...r,
                syncedToSheet: Boolean(existing.syncedToSheet || r.syncedToSheet),
                values: { ...existing.values, ...r.values },
              }
            : r
        );
      });

      const mergedRepAppMap = new Map<string, StoredRepairApproval>();
      (remote.repairApprovals ?? [])
        .filter((a) => isRecentOptimisticMutation(a.updatedAt))
        .forEach((a) => mergedRepAppMap.set(a.sequenceNo || String(a.rowNumber), a));
      local.repairApprovals.forEach((a) =>
        mergedRepAppMap.set(a.sequenceNo || String(a.rowNumber), a)
      );

      const mergedPhotoEditMap = new Map<string, StoredRepairPhotoEdit>();
      (remote.repairPhotoEdits ?? [])
        .filter((p) => isRecentOptimisticMutation(p.updatedAt))
        .forEach((p) =>
          mergedPhotoEditMap.set(
            p.sequenceNo || p.repairRequestNo || String(p.rowNumber),
            p
          )
        );
      local.repairPhotoEdits.forEach((p) =>
        mergedPhotoEditMap.set(
          p.sequenceNo || p.repairRequestNo || String(p.rowNumber),
          p
        )
      );

      const mergedDetailEditMap = new Map<string, StoredRepairDetailEdit>();
      (remote.repairDetailEdits ?? [])
        .filter((d) => isRecentOptimisticMutation(d.updatedAt))
        .forEach((d) =>
          mergedDetailEditMap.set(
            d.sequenceNo || d.repairRequestNo || String(d.rowNumber),
            d
          )
        );
      (local.repairDetailEdits ?? []).forEach((d) =>
        mergedDetailEditMap.set(
          d.sequenceNo || d.repairRequestNo || String(d.rowNumber),
          d
        )
      );

      const mergedReplyEditMap = new Map<string, StoredRepairReplyEdit>();
      (remote.repairReplyEdits ?? [])
        .filter((d) => isRecentOptimisticMutation(d.updatedAt))
        .forEach((d) =>
          mergedReplyEditMap.set(
            d.sequenceNo || d.repairRequestNo || String(d.rowNumber),
            d
          )
        );
      (local.repairReplyEdits ?? []).forEach((d) =>
        mergedReplyEditMap.set(
          d.sequenceNo || d.repairRequestNo || String(d.rowNumber),
          d
        )
      );

      const mergedFinancialEditMap = new Map<string, StoredRepairFinancialEdit>();
      (remote.repairFinancialEdits ?? [])
        .filter((f) => isRecentOptimisticMutation(f.updatedAt))
        .forEach((f) =>
          mergedFinancialEditMap.set(
            f.sequenceNo || f.repairRequestNo || String(f.rowNumber),
            f
          )
        );
      (local.repairFinancialEdits ?? []).forEach((f) =>
        mergedFinancialEditMap.set(
          f.sequenceNo || f.repairRequestNo || String(f.rowNumber),
          f
        )
      );

      const mergedVehFieldMap = new Map<string, StoredVehicleFieldEdit>();
      (remote.vehicleFieldEdits ?? []).forEach((e) =>
        mergedVehFieldMap.set(`${e.rowNumber}|${e.colId}`, e)
      );
      (local.vehicleFieldEdits ?? []).forEach((e) =>
        mergedVehFieldMap.set(`${e.rowNumber}|${e.colId}`, e)
      );

      const mergedRepInspMap = new Map<string, StoredRepairInspection>();
      (remote.repairInspections ?? [])
        .filter((i) => isRecentOptimisticMutation(i.updatedAt))
        .forEach((i) =>
          mergedRepInspMap.set(
            i.sequenceNo || i.repairRequestNo || String(i.rowNumber),
            i
          )
        );
      (local.repairInspections ?? []).forEach((i) =>
        mergedRepInspMap.set(
          i.sequenceNo || i.repairRequestNo || String(i.rowNumber),
          i
        )
      );

      const mergedFuelMap = new Map<string, StoredFuelRecord>();
      (remote.fuelRecords ?? []).forEach((f) => mergedFuelMap.set(f.id, f));
      (local.fuelRecords ?? []).forEach((f) => {
        const existing = mergedFuelMap.get(f.id);
        mergedFuelMap.set(
          f.id,
          existing
            ? {
                ...existing,
                ...f,
                syncedToSheet: Boolean(existing.syncedToSheet || f.syncedToSheet),
                values: { ...existing.values, ...f.values },
              }
            : f
        );
      });

      return {
        jobTransfers: Array.from(mergedJobMap.values()),
        deliveryPoints: Array.from(mergedDpMap.values()),
        deliveryPointEdits: Array.from(mergedDpEditMap.values()),
        vehicleRegEdits: mergedVehEdits,
        vehicleFieldEdits: Array.from(mergedVehFieldMap.values()),
        jobTransferNoteEdits: Array.from(mergedNoteMap.values()),
        repairRequests: Array.from(mergedRepReqMap.values()),
        repairApprovals: Array.from(mergedRepAppMap.values()),
        repairInspections: Array.from(mergedRepInspMap.values()),
        repairPhotoEdits: Array.from(mergedPhotoEditMap.values()),
        repairDetailEdits: Array.from(mergedDetailEditMap.values()),
        repairReplyEdits: Array.from(mergedReplyEditMap.values()),
        repairFinancialEdits: Array.from(mergedFinancialEditMap.values()),
        fuelRecords: Array.from(mergedFuelMap.values()),
      };
  } catch {
    // ignore fetch error on static hosting
  }
  return local;
}

async function postJobTransferRowToGoogleSheetsApi(
  rowValues: Array<string | number>,
  accessToken: string
): Promise<number | null> {
  const range = encodeURIComponent('บันทึกการย้ายงาน!A:A');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [rowValues],
    }),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      invalidateCachedToken();
    }
    throw new Error(`Google Sheets API HTTP ${response.status}`);
  }

  let rowNumber: number | null = null;
  try {
    const resJson = await response.json();
    const updatedRange: string = resJson?.updates?.updatedRange ?? '';
    const match = updatedRange.match(/![A-Z]+(\d+)/i);
    if (match && match[1]) {
      rowNumber = parseInt(match[1], 10);
    }
  } catch {
    // ignore parse error
  }
  return rowNumber;
}

async function postRepairRowToGoogleSheetsApi(
  rowValues: Array<string | number>,
  accessToken: string
): Promise<number | null> {
  const safeRowValues = rowValues.map((val) =>
    typeof val === 'string' && val.length > 48000 ? '' : val
  );
  const range = encodeURIComponent('บันทึกงานซ่อม!A:A');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [safeRowValues],
    }),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      invalidateCachedToken();
    }
    throw new Error(`Google Sheets API HTTP ${response.status}`);
  }

  let rowNumber: number | null = null;
  try {
    const resJson = await response.json();
    const updatedRange: string = resJson?.updates?.updatedRange ?? '';
    const match = updatedRange.match(/![A-Z]+(\d+)/i);
    if (match && match[1]) {
      rowNumber = parseInt(match[1], 10);
    }
  } catch {
    // ignore parse error
  }
  return rowNumber;
}

async function resolveJobTransferSheetRowNumber(
  accessToken: string,
  fallbackRowNumber: number | null,
  recordId: string
): Promise<number> {
  try {
    const count = await fetchSheetRowCount('606634465');
    const startRow = Math.max(2, count - 250);
    const endRow = count + 20;
    const range = encodeURIComponent(`บันทึกการย้ายงาน!Q${startRow}:Q${endRow}`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      const rows: string[][] = data?.values ?? [];
      for (let i = rows.length - 1; i >= 0; i--) {
        if ((rows[i]?.[0] ?? '').trim() === recordId.trim()) {
          return startRow + i;
        }
      }
    }
  } catch {
    // ignore
  }
  return fallbackRowNumber && fallbackRowNumber >= 2 ? fallbackRowNumber : 0;
}

async function resolveRepairSheetRowNumber(
  accessToken: string,
  fallbackRowNumber: number,
  sequenceNo?: string,
  repairRequestNo?: string
): Promise<number> {
  const seq = (sequenceNo ?? '').trim();
  const reqNo = (repairRequestNo ?? '').trim();
  if (seq || reqNo) {
    try {
      const count = await fetchSheetRowCount('944294225');
      const startRow = Math.max(2, count - 300);
      const endRow = count + 30;
      const range = encodeURIComponent(`บันทึกงานซ่อม!A${startRow}:G${endRow}`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const rows: string[][] = data?.values ?? [];
        for (let i = rows.length - 1; i >= 0; i--) {
          const rowSeq = String(rows[i]?.[0] ?? '').trim();
          const rowReqNo = String(rows[i]?.[6] ?? '').trim();
          if ((reqNo && rowReqNo === reqNo) || (seq && rowSeq === seq)) {
            return startRow + i;
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return fallbackRowNumber >= 2 ? fallbackRowNumber : 0;
}

export async function flushPendingMutationsToGoogleSheet(): Promise<void> {
  try {
    const store = await fetchCombinedMutationsStore();
    const scriptUrl = getConfiguredAppsScriptUrl();
    const token = await getOrConnectAccessToken(false);
    if (!scriptUrl && !token) return;

    const localStore = readLocalMutationsStore();
    let localChanged = false;

    for (const jt of store.jobTransfers) {
      if (jt.syncedToSheet) continue;
      const v = jt.values;
      const weightNum = Number((v['G'] ?? '0').replace(/,/g, '')) || 0;
      const roundsNum = Number((v['V'] ?? '1').replace(/,/g, '')) || 1;
      const noteText = v['N'] || v['R'] || '';
      const rowValues: Array<string | number> = [
        v['A'] ?? '',
        v['B'] ?? '',
        v['C'] ?? '',
        v['D'] ?? '',
        v['E'] ?? '',
        v['F'] ?? '',
        weightNum,
        v['H'] ?? '',
        v['I'] ?? '',
        v['J'] ?? '',
        v['K'] ?? '',
        v['L'] ?? '',
        v['M'] ?? '',
        noteText,
        '',
        v['P'] ?? `${v['A'] ?? ''} ${v['I'] ?? ''}`.trim(),
        jt.recordId,
        noteText,
        '',
        '',
        weightNum > 0 ? weightNum : '',
        roundsNum,
      ];

      let sheetRowNumber: number | null = null;
      let synced = false;

      if (scriptUrl) {
        try {
          const res = await callAppsScriptWebhook(scriptUrl, {
            action: 'appendJobTransfer',
            rowValues,
          });
          sheetRowNumber = res.rowNumber ?? null;
          synced = true;
        } catch {
          // try token next
        }
      }

      if (!synced && token) {
        try {
          sheetRowNumber = await postJobTransferRowToGoogleSheetsApi(rowValues, token);
          synced = true;
        } catch {
          // keep unsynced
        }
      }

      if (!synced) continue;

      jt.syncedToSheet = true;
      if (sheetRowNumber && sheetRowNumber > 0) {
        jt.rowNumber = sheetRowNumber;
      }

      const localItem = localStore.jobTransfers.find(
        (item) => item.recordId === jt.recordId
      );
      if (localItem) {
        localItem.syncedToSheet = true;
        if (sheetRowNumber && sheetRowNumber > 0) {
          localItem.rowNumber = sheetRowNumber;
        }
        localChanged = true;
      }

      void fetch('/api/mutations/mark-synced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: jt.recordId,
          sheetRowNumber,
        }),
      }).catch(() => {});
    }

    const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
    for (const req of store.repairRequests) {
      if (req.syncedToSheet) continue;
      const v = req.values;
      const rowValues: Array<string | number> = new Array(38).fill('');
      rowValues[0] = Number(req.sequenceNo) || req.sequenceNo;
      rowValues[1] = v['B'] ?? '';
      rowValues[2] = v['C'] ?? '';
      rowValues[3] = v['D'] ?? '';
      rowValues[4] = v['E'] ?? '';
      rowValues[5] = v['F'] ?? '';
      rowValues[6] = v['G'] ?? '';
      rowValues[13] = v['N'] ?? '';
      rowValues[14] = v['O'] ?? '';
      rowValues[15] = v['P'] || 'รอตรวจสอบ';
      photoCols.forEach((col, idx) => {
        rowValues[16 + idx] = v[col] ?? '';
      });
      rowValues[26] = v['AA'] ?? '';
      rowValues[27] = v['AB'] ?? '';
      rowValues[28] = v['AC'] ?? '';
      rowValues[29] = v['AD'] ?? '';
      rowValues[30] = v['AE'] ?? '';
      rowValues[31] = v['AF'] ?? '';
      rowValues[32] = v['AG'] ?? '';
      rowValues[33] = v['AH'] ?? '';
      rowValues[34] = v['AI'] || 'รอตรวจสอบ';
      rowValues[35] = v['AJ'] || req.id;

      let sheetRowNumber: number | null = null;
      let synced = false;

      if (scriptUrl) {
        try {
          const res = await callAppsScriptWebhook(scriptUrl, {
            action: 'appendRepairRequest',
            rowValues,
          });
          sheetRowNumber = res.rowNumber ?? null;
          synced = true;
        } catch {
          // try token next
        }
      }

      if (!synced && token) {
        try {
          sheetRowNumber = await postRepairRowToGoogleSheetsApi(rowValues, token);
          synced = true;
        } catch {
          // keep unsynced
        }
      }

      if (!synced) continue;

      req.syncedToSheet = true;
      if (sheetRowNumber && sheetRowNumber > 0) {
        req.rowNumber = sheetRowNumber;
      }

      const localReq = localStore.repairRequests.find((item) => item.id === req.id);
      if (localReq) {
        localReq.syncedToSheet = true;
        if (sheetRowNumber && sheetRowNumber > 0) {
          localReq.rowNumber = sheetRowNumber;
        }
        localChanged = true;
      }

      void fetch('/api/mutations/mark-synced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId: req.id,
          sheetRowNumber,
        }),
      }).catch(() => {});
    }

    if (localChanged) {
      writeLocalMutationsStore(localStore);
    }
  } catch {
    // ignore background sync errors
  }
}

interface GvizCell {
  v?: string | number | boolean | null;
  f?: string | null;
}

interface GvizRow {
  c: Array<GvizCell | null>;
}

interface GvizCol {
  id: string;
  label: string;
  type: string;
}

interface GvizResponse {
  status: string;
  table: {
    cols: GvizCol[];
    rows: GvizRow[];
    parsedNumHeaders?: number;
  };
}

function parseGvizJson(rawText: string): GvizResponse {
  const startIdx = rawText.indexOf('{');
  const endIdx = rawText.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('รูปแบบข้อมูลตอบกลับจาก Google Sheets ไม่ถูกต้อง');
  }
  return JSON.parse(rawText.substring(startIdx, endIdx + 1)) as GvizResponse;
}

function formatGvizCellValue(cell: GvizCell | null | undefined): string {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null && String(cell.f).trim() !== '') {
    return String(cell.f).trim();
  }
  if (cell.v === undefined || cell.v === null) return '';
  const raw = String(cell.v).trim();
  const dateMatch = raw.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) + 1;
    const day = Number(dateMatch[3]);
    if (year === 1899 && month === 12 && day === 30 && dateMatch[4] !== undefined) {
      const hh = String(dateMatch[4]).padStart(2, '0');
      const mm = String(dateMatch[5]).padStart(2, '0');
      const ss = String(dateMatch[6]).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }
    return `${day}/${month}/${year}`;
  }
  return raw;
}

const inFlightGvizMap = new Map<string, Promise<GvizResponse>>();

async function queryGviz(
  gid: string,
  tq: string,
  signal?: AbortSignal,
  timeoutMs = 20000
): Promise<GvizResponse> {
  if (signal?.aborted) {
    const abortErr = new Error('การร้องขอถูกยกเลิก');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  const cacheKey = `${gid}::${tq}`;
  let sharedPromise = inFlightGvizMap.get(cacheKey);

  if (!sharedPromise) {
    const params = new URLSearchParams({
      tqx: 'out:json',
      gid,
      tq,
      _t: String(Date.now()),
    });
    const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?${params.toString()}`;

    sharedPromise = (async () => {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
      try {
        const response = await fetch(url, { signal: timeoutController.signal });
        if (!response.ok) {
          throw new Error(`ไม่สามารถเชื่อมต่อ Google Sheets (HTTP ${response.status})`);
        }
        const text = await response.text();
        return parseGvizJson(text);
      } catch (err: unknown) {
        if (timeoutController.signal.aborted) {
          throw new Error('การดึงข้อมูลจาก Google Sheets ใช้เวลานานเกินกำหนด กรุณากดซิงค์ข้อมูลอีกครั้ง');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    })().finally(() => {
      inFlightGvizMap.delete(cacheKey);
    });

    inFlightGvizMap.set(cacheKey, sharedPromise);
  }

  if (!signal) {
    return sharedPromise;
  }

  return new Promise<GvizResponse>((resolve, reject) => {
    const onAbort = () => {
      const abortErr = new Error('การร้องขอถูกยกเลิก');
      abortErr.name = 'AbortError';
      reject(abortErr);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    sharedPromise!
      .then((res) => {
        signal.removeEventListener('abort', onAbort);
        resolve(res);
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

const rowCountCache = new Map<string, { count: number; timestamp: number }>();

function getStoredRowCount(gid: string): number {
  const cached = rowCountCache.get(gid);
  if (cached && cached.count > 0 && Date.now() - cached.timestamp < 30_000) {
    return cached.count;
  }
  try {
    const raw = localStorage.getItem(`gsheets_row_count_${gid}`);
    if (raw) {
      const num = parseInt(raw, 10);
      if (!isNaN(num) && num > 0) {
        return num;
      }
    }
  } catch {
    // ignore
  }
  return cached?.count ?? 0;
}

function setStoredRowCount(gid: string, count: number): void {
  if (count <= 0) return;
  rowCountCache.set(gid, { count, timestamp: Date.now() });
  try {
    localStorage.setItem(`gsheets_row_count_${gid}`, String(count));
  } catch {
    // ignore
  }
}

export async function fetchSheetRowCount(
  gid: string,
  signal?: AbortSignal
): Promise<number> {
  const cachedCount = getStoredRowCount(gid);
  const mem = rowCountCache.get(gid);
  if (cachedCount > 0 && mem && Date.now() - mem.timestamp < 15_000) {
    return cachedCount;
  }
  try {
    const res = await queryGviz(gid, 'select count(A)', signal, 15000);
    const val = res.table?.rows?.[0]?.c?.[0]?.v;
    const count = typeof val === 'number' ? val : 0;
    if (count > 0) {
      setStoredRowCount(gid, count);
    }
    return count > 0 ? count : cachedCount;
  } catch {
    return cachedCount;
  }
}

export async function fetchSheetTabData(
  tab: SheetTabConfig,
  options?: {
    limit?: number;
    remoteSearchQuery?: string;
    signal?: AbortSignal;
  }
): Promise<SheetDataResult> {
  const limit = options?.limit ?? tab.defaultLimit ?? 250;
  const search = options?.remoteSearchQuery?.trim() ?? '';

  const [totalRowsInSheet, mutationsStore] = await Promise.all([
    fetchSheetRowCount(tab.gid, options?.signal),
    fetchCombinedMutationsStore(options?.signal),
  ]);

  let dataResponse: GvizResponse;
  let rowOffset = 0;

  if (search.length > 0 && totalRowsInSheet > limit) {
    const metaRes = await queryGviz(tab.gid, 'select * limit 1', options?.signal, 12000);
    const stringCols = (metaRes.table?.cols ?? []).filter(
      (c) => c.type === 'string' && (c.label || FALLBACK_COLUMN_LABELS[tab.gid]?.[c.id])
    );

    if (stringCols.length > 0) {
      const escaped = search.replace(/'/g, "\\'").toLowerCase();
      const whereClause = stringCols
        .map((c) => `lower(${c.id}) contains '${escaped}'`)
        .join(' or ');
      const searchTq = `select * where ${whereClause} limit ${limit}`;
      dataResponse = await queryGviz(tab.gid, searchTq, options?.signal, 20000);
    } else {
      dataResponse = await queryGviz(
        tab.gid,
        `select * limit ${limit}`,
        options?.signal,
        20000
      );
    }
  } else if (tab.reverseOrder && totalRowsInSheet > limit) {
    rowOffset = Math.max(0, totalRowsInSheet - limit);
    try {
      dataResponse = await queryGviz(
        tab.gid,
        `select * offset ${rowOffset}`,
        options?.signal,
        20000
      );
    } catch {
      // Fallback to limit query if offset query fails
      dataResponse = await queryGviz(
        tab.gid,
        `select * limit ${limit}`,
        options?.signal,
        15000
      );
      rowOffset = 0;
    }
  } else {
    dataResponse = await queryGviz(
      tab.gid,
      `select * limit ${limit}`,
      options?.signal,
      20000
    );
  }

  const rawCols = dataResponse.table?.cols ?? [];
  let rawRows = dataResponse.table?.rows ?? [];

  if (tab.reverseOrder && rowOffset > 0 && rawRows.length > 0) {
    const estimatedTotal = rowOffset + rawRows.length;
    if (estimatedTotal > totalRowsInSheet) {
      setStoredRowCount(tab.gid, estimatedTotal);
    }
  }

  // Auto-discover Apps Script URL if present in column D of จุดส่งสินค้า
  if (tab.gid === '1156877149') {
    const colD = rawCols.find((c) => c.id === 'D');
    if (colD?.label?.trim().startsWith('https://script.google.com/')) {
      const normD = normalizeAppsScriptUrl(colD.label.trim());
      if (
        !configuredAppsScriptUrl ||
        configuredAppsScriptUrl.includes(STALE_APPS_SCRIPT_ID) ||
        configuredAppsScriptUrl !== normD
      ) {
        configuredAppsScriptUrl = normD;
        try {
          localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, normD);
        } catch {
          // ignore
        }
      }
    }
  }

  const hasAnyColLabel = rawCols.some((c) => c.label && c.label.trim() !== '');
  const promotedHeaderRow: Record<string, string> = {};

  if (!hasAnyColLabel && rawRows.length > 0) {
    const firstRow = rawRows[0];
    firstRow.c.forEach((cell, idx) => {
      const colId = rawCols[idx]?.id;
      const cellText = formatGvizCellValue(cell);
      if (colId && cellText) {
        promotedHeaderRow[colId] = cellText;
      }
    });
    rawRows = rawRows.slice(1);
  }

  const allColumns: SheetColumn[] = [];
  const activeColumns: SheetColumn[] = [];
  rawCols.forEach((col, colIndex) => {
    const fallbackLabel =
      FALLBACK_COLUMN_LABELS[tab.gid]?.[col.id] ?? promotedHeaderRow[col.id] ?? '';
    const label = (col.label?.trim() || fallbackLabel).trim();

    if (label.startsWith('https://script.google.com/')) {
      return;
    }

    const hasDataInRows = rawRows.some((r) => {
      const cell = r.c?.[colIndex];
      return formatGvizCellValue(cell) !== '';
    });

    if (label !== '' && (col.label?.trim() !== '' || fallbackLabel !== '' || hasDataInRows)) {
      const colObj: SheetColumn = {
        id: col.id,
        label,
        type: col.type || 'string',
      };
      allColumns.push(colObj);

      const isHiddenById = HIDDEN_COLUMN_IDS[tab.gid]?.has(col.id);
      const isHiddenByLabel =
        HIDDEN_COLUMN_LABELS[tab.gid]?.has(label) ||
        HIDDEN_COLUMN_LABELS[tab.gid]?.has(label.trim()) ||
        Array.from(HIDDEN_COLUMN_LABELS[tab.gid] || []).some(
          (hLabel) => hLabel.trim().toLowerCase() === label.trim().toLowerCase()
        );

      if (!isHiddenById && !isHiddenByLabel) {
        activeColumns.push(colObj);
      }
    }
  });

  // In ฐานข้อมูลรถ (gid: 378250263), display the key columns including รูปรถ (B) and รูปพนักงาน (M):
  // รูปรถ (B), รูปพนักงาน (M), ชื่อพนักงานประจำรถ (I), ทะเบียนรถ (A), พื้นที่ปฎิบัติงาน (J), กะทำงาน (L), ทีม (O)
  if (tab.gid === '378250263') {
    const orderedActiveIds = ['B', 'M', 'I', 'A', 'J', 'L', 'O'];
    const colMap = new Map(allColumns.map((c) => [c.id, c]));
    activeColumns.length = 0;
    orderedActiveIds.forEach((id) => {
      const col = colMap.get(id);
      if (col) activeColumns.push(col);
    });
    const remainingCols = allColumns.filter((c) => !orderedActiveIds.includes(c.id));
    allColumns.length = 0;
    allColumns.push(...activeColumns, ...remainingCols);
  }

  const parsedRows: SheetRow[] = [];

  const colIdxR =
    tab.gid === '606634465' ? rawCols.findIndex((c) => c.id === 'R') : -1;
  const colIdxQ =
    tab.gid === '606634465' ? rawCols.findIndex((c) => c.id === 'Q') : -1;

  const existingRecordIds = new Set<string>();

  rawRows.forEach((r, idx) => {
    const values: Record<string, string> = {};
    const rawValues: Record<string, string | number | null> = {};
    let hasNonEmptyValue = false;

    if (colIdxQ >= 0) {
      const qVal = formatGvizCellValue(r.c?.[colIdxQ]);
      if (qVal) existingRecordIds.add(qVal);
    }

    allColumns.forEach((col) => {
      const colIdx = rawCols.findIndex((c) => c.id === col.id);
      const cell = colIdx >= 0 ? r.c?.[colIdx] : null;
      let formatted = formatGvizCellValue(cell);
      if (tab.gid === '606634465' && col.id === 'N' && !formatted && colIdxR >= 0) {
        formatted = formatGvizCellValue(r.c?.[colIdxR]);
      }
      values[col.id] = formatted;
      rawValues[col.id] =
        typeof cell?.v === 'number' || typeof cell?.v === 'string'
          ? cell.v
          : formatted || null;
      if (formatted !== '') {
        hasNonEmptyValue = true;
      }
    });

    if (hasNonEmptyValue) {
      parsedRows.push({
        rowNumber: rowOffset + idx + 1,
        values,
        rawValues,
      });
    }
  });

  // Overlay local/backend mutations so unsynced pending records are immediately visible
  if (tab.gid === '606634465') {
    for (const jt of mutationsStore.jobTransfers) {
      if (jt.syncedToSheet) continue;
      const existingRow = parsedRows.find(
        (r) =>
          (jt.recordId && (r.values['Q'] ?? '').trim() === jt.recordId) ||
          ((r.values['A'] ?? '').trim() === (jt.values['A'] ?? '').trim() &&
            (r.values['C'] ?? '').trim() === (jt.values['C'] ?? '').trim() &&
            (r.values['D'] ?? '').trim() === (jt.values['D'] ?? '').trim() &&
            (r.values['I'] ?? '').trim() === (jt.values['I'] ?? '').trim())
      );
      if (existingRow) {
        if (jt.values['K']) existingRow.values['K'] = jt.values['K'];
        if (jt.values['L']) existingRow.values['L'] = jt.values['L'];
        if (jt.values['M']) existingRow.values['M'] = jt.values['M'];
        if (jt.values['N']) existingRow.values['N'] = jt.values['N'];
      } else if (!existingRecordIds.has(jt.recordId) && !search) {
        const rowNumber =
          jt.rowNumber && jt.rowNumber > totalRowsInSheet
            ? jt.rowNumber
            : totalRowsInSheet + parsedRows.length + 1;
        parsedRows.push({
          rowNumber,
          values: { ...jt.values },
          rawValues: {
            ...jt.values,
            G: Number(jt.values['G'] ?? 0) || 0,
          },
        });
      }
    }

    for (const noteEdit of mutationsStore.jobTransferNoteEdits) {
      const target = parsedRows.find(
        (r) =>
          (r.values['A'] ?? '').trim() === noteEdit.date &&
          (r.values['C'] ?? '').trim() === noteEdit.driverName &&
          (r.values['D'] ?? '').trim() === noteEdit.vehicleNumber &&
          (r.values['I'] ?? '').trim() === noteEdit.startTime
      );
      if (target) {
        target.values['N'] = noteEdit.note;
      }
    }
  } else if (tab.gid === '1156877149') {
    for (const dp of mutationsStore.deliveryPoints) {
      const exists = parsedRows.some(
        (r) => (r.values['B'] ?? '').trim() === (dp.values['B'] ?? '').trim()
      );
      if (!exists) {
        parsedRows.push({
          rowNumber: parsedRows.length + 1,
          values: { ...dp.values },
          rawValues: { ...dp.values },
        });
      }
    }
    for (const edit of mutationsStore.deliveryPointEdits) {
      const target = parsedRows.find(
        (r) => (r.values['B'] ?? '').trim() === edit.deliveryPoint
      );
      if (target) {
        target.values['C'] = edit.newGate;
        if (edit.updatedDate) target.values['A'] = edit.updatedDate;
      }
    }
  } else if (tab.gid === '378250263') {
    for (const edit of mutationsStore.vehicleRegEdits) {
      const target = parsedRows.find(
        (r) =>
          (r.values['A'] ?? '').trim() === edit.oldRegistration &&
          (!edit.driverName || (r.values['I'] ?? '').trim() === edit.driverName)
      );
      if (target) {
        target.values['A'] = edit.newRegistration;
      }
    }
    for (const fieldEdit of mutationsStore.vehicleFieldEdits ?? []) {
      const target = parsedRows.find((r) => r.rowNumber === fieldEdit.rowNumber);
      if (target && fieldEdit.colId) {
        target.values[fieldEdit.colId] = fieldEdit.value;
        target.rawValues[fieldEdit.colId] = fieldEdit.value;
      }
    }
  } else if (tab.gid === '944294225') {
    const matchesRepairRow = (
      r: SheetRow,
      item: { sequenceNo?: string; repairRequestNo?: string; rowNumber: number }
    ): boolean => {
      const seq = (item.sequenceNo ?? '').trim();
      const reqNo = (item.repairRequestNo ?? '').trim();
      if (seq) {
        return (r.values['A'] ?? '').trim() === seq;
      }
      if (reqNo) {
        return (r.values['G'] ?? '').trim() === reqNo;
      }
      return item.rowNumber > 0 && r.rowNumber === item.rowNumber;
    };

    for (const req of mutationsStore.repairRequests) {
      if (!isRecentOptimisticMutation(req.createdAt)) continue;
      const reqG = (req.values['G'] ?? '').trim();
      const exists = parsedRows.some(
        (r) =>
          (req.id && (r.values['AJ'] ?? '').trim() === req.id) ||
          (reqG !== '' && (r.values['G'] ?? '').trim() === reqG) ||
          ((r.values['B'] ?? '').trim() === (req.values['B'] ?? '').trim() &&
            (r.values['C'] ?? '').trim() === (req.values['C'] ?? '').trim() &&
            (r.values['D'] ?? '').trim() === (req.values['D'] ?? '').trim() &&
            (r.values['F'] ?? '').trim() === (req.values['F'] ?? '').trim())
      );
      if (!exists && !search) {
        parsedRows.push({
          rowNumber: req.rowNumber,
          values: { ...req.values },
          rawValues: { ...req.values, A: Number(req.sequenceNo) || req.rowNumber },
        });
      }
    }
    for (const insp of mutationsStore.repairInspections ?? []) {
      if (!isRecentOptimisticMutation(insp.updatedAt)) continue;
      const target = parsedRows.find((r) => matchesRepairRow(r, insp));
      if (target) {
        target.values['AB'] = insp.inspectorName;
        target.values['AC'] = insp.inspectionDate;
        target.values['AD'] = insp.inspectionTime;
        target.values['P'] = 'ตรวจสอบแล้ว';
        target.values['AI'] = '2.⚠️รออนุมัติ';
        if (insp.sparePartsCost !== undefined) target.values['N'] = insp.sparePartsCost;
        if (insp.laborCost !== undefined) target.values['O'] = insp.laborCost;
        if (insp.note !== undefined && insp.note !== '') target.values['AH'] = insp.note;
      }
    }
    for (const app of mutationsStore.repairApprovals ?? []) {
      if (!isRecentOptimisticMutation(app.updatedAt)) continue;
      const target = parsedRows.find((r) => matchesRepairRow(r, app));
      if (target) {
        target.values['AE'] = app.approverName;
        target.values['AF'] = app.approvalDate;
        target.values['AG'] = app.approvalTime;
        target.values['AI'] = app.approvalStatus;
        if (app.repairStatus) target.values['P'] = app.repairStatus;
        if (app.note) target.values['AH'] = app.note;
      }
    }
    for (const pe of mutationsStore.repairPhotoEdits) {
      if (!isRecentOptimisticMutation(pe.updatedAt)) continue;
      const target = parsedRows.find((r) => matchesRepairRow(r, pe));
      if (target) {
        const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
        photoCols.forEach((col, idx) => {
          target.values[col] = (pe.photos[idx] ?? '').trim();
        });
      }
    }
    if (Array.isArray(mutationsStore.repairDetailEdits)) {
      for (const de of mutationsStore.repairDetailEdits) {
        if (!isRecentOptimisticMutation(de.updatedAt)) continue;
        const target = parsedRows.find((r) => matchesRepairRow(r, de));
        if (target) {
          target.values['AK'] = de.additionalDetails;
        }
      }
    }
    if (Array.isArray(mutationsStore.repairReplyEdits)) {
      for (const re of mutationsStore.repairReplyEdits) {
        if (!isRecentOptimisticMutation(re.updatedAt)) continue;
        const target = parsedRows.find((r) => matchesRepairRow(r, re));
        if (target) {
          target.values['AM'] = re.replyDetails;
          if (re.replyDetails && re.replyDetails.trim() !== '') {
            target.values['AI'] = '4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว';
          }
        }
      }
    }
    if (Array.isArray(mutationsStore.repairFinancialEdits)) {
      for (const fe of mutationsStore.repairFinancialEdits) {
        if (!isRecentOptimisticMutation(fe.updatedAt)) continue;
        const target = parsedRows.find((r) => matchesRepairRow(r, fe));
        if (target) {
          target.values['N'] = fe.sparePartsCost;
          target.values['O'] = fe.laborCost;
        }
      }
    }
  } else if (tab.gid === '1733355146') {
    for (const fuel of mutationsStore.fuelRecords ?? []) {
      const exists = parsedRows.some(
        (r) =>
          (fuel.id && (r.values['A'] ?? '').trim() === fuel.id) ||
          ((r.values['B'] ?? '').trim() === (fuel.values['B'] ?? '').trim() &&
            (r.values['C'] ?? '').trim() === (fuel.values['C'] ?? '').trim() &&
            (r.values['D'] ?? '').trim() === (fuel.values['D'] ?? '').trim() &&
            (r.values['S'] ?? '').trim() === (fuel.values['S'] ?? '').trim())
      );
      if (!exists && !search) {
        parsedRows.push({
          rowNumber: fuel.rowNumber || totalRowsInSheet + parsedRows.length + 1,
          values: { ...fuel.values },
          rawValues: { ...fuel.values },
        });
      }
    }
  }

  if (tab.reverseOrder) {
    parsedRows.reverse();
  }

  return {
    sheetId: GOOGLE_SHEET_ID,
    gid: tab.gid,
    tabName: tab.name,
    columns: activeColumns,
    allColumns,
    rows: parsedRows,
    totalRowsInSheet: Math.max(totalRowsInSheet, parsedRows.length),
    fetchedAt: new Date().toISOString(),
  };
}

export async function appendJobTransferRecord(
  payload: JobTransferPayload
): Promise<{ recordId: string; rowNumber: number | null; syncedToSheet?: boolean }> {
  const recordId = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const transactionTimestamp = `${payload.date} ${payload.startTime}`;

  const rowValues: Array<string | number> = [
    payload.date, // A: วันที่
    payload.employeeId, // B: รหัสพนักงาน
    payload.driverName, // C: ชื่อพนักงานขับรถ
    payload.vehicleNumber, // D: เบอร์รถ
    payload.trailerNumber, // E: เบอร์หาง
    payload.productType, // F: ประเภทสินค้า
    payload.weight, // G: น้ำหนัก
    payload.origin, // H: ต้นทาง
    payload.startTime, // I: เวลาเริ่ม
    payload.destination, // J: ปลายทาง
    payload.endTime, // K: เวลาจบ
    payload.duration, // L: เวลาที่ใช้
    payload.status, // M: สถานะ
    payload.note || '', // N: หมายเหตุ
    '', // O
    transactionTimestamp, // P: วันเวลาทำรายการ
    recordId, // Q: รหัสรายการ (ID)
    payload.note || '', // R: หมายเหตุ
    '', // S: ภาพถ่ายที่ 1
    '', // T: ภาพถ่ายที่ 2
    payload.weight > 0 ? payload.weight : '', // U: น้ำหนักสุทธิ
    payload.rounds || 1, // V: จำนวนรอบ
  ];

  const valuesMap: Record<string, string> = {
    A: payload.date,
    B: payload.employeeId,
    C: payload.driverName,
    D: payload.vehicleNumber,
    E: payload.trailerNumber,
    F: payload.productType,
    G: String(payload.weight),
    H: payload.origin,
    I: payload.startTime,
    J: payload.destination,
    K: payload.endTime,
    L: payload.duration,
    M: payload.status,
    N: payload.note || '',
    P: transactionTimestamp,
    Q: recordId,
    R: payload.note || '',
    S: '',
    T: '',
    U: payload.weight > 0 ? String(payload.weight) : '',
    V: String(payload.rounds || 1),
  };

  let rowNumber: number | null = null;
  let syncedToSheet = false;

  // 1. Try Google Apps Script Webhook (No-Login Direct Google Sheet Write)
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      const res = await callAppsScriptWebhook(scriptUrl, {
        action: 'appendJobTransfer',
        rowValues,
      });
      if (res.ok !== false) {
        rowNumber = res.rowNumber ?? null;
        syncedToSheet = true;
      }
    } catch {
      // fall through to OAuth token or local store
    }
  }

  // 2. Try Google Sheets REST API v4 with cached or connected OAuth token
  if (!syncedToSheet) {
    const token = await getOrConnectAccessToken(true);
    if (token) {
      try {
        rowNumber = await postJobTransferRowToGoogleSheetsApi(rowValues, token);
        syncedToSheet = true;
      } catch {
        // fall through to local/server persistence
      }
    }
  }

  // 3. Always persist to local & backend store
  const currentSheetCount = await fetchSheetRowCount('606634465');
  const localStore = readLocalMutationsStore();
  const baseRow = Math.max(currentSheetCount, 56278) + localStore.jobTransfers.length + 1;
  const fallbackRowNumber = rowNumber ?? baseRow;

  localStore.jobTransfers.push({
    recordId,
    rowNumber: fallbackRowNumber,
    values: valuesMap,
    createdAt: new Date().toISOString(),
    syncedToSheet,
  });
  writeLocalMutationsStore(localStore);

  try {
    const res = await fetch('/api/mutations/job-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordId,
        rowNumber: fallbackRowNumber,
        baseRowNumber: fallbackRowNumber - 1,
        values: valuesMap,
        syncedToSheet,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { rowNumber?: number };
      if (!rowNumber && data.rowNumber) {
        rowNumber = data.rowNumber;
      }
      if (syncedToSheet) {
        void fetch('/api/mutations/mark-synced', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId, sheetRowNumber: rowNumber }),
        }).catch(() => {});
      }
    }
  } catch {
    // ignore on static hosting
  }

  return { recordId, rowNumber: rowNumber ?? fallbackRowNumber, syncedToSheet };
}

export async function completeJobTransferRecord(params: {
  recordId: string;
  rowNumber: number | null;
  endTime: string;
  duration: string;
  status?: string;
}): Promise<{ syncedToSheet: boolean }> {
  const finalStatus = params.status || 'ส่งสินค้าเรียบร้อยแล้ว';
  let completedOnSheet = false;

  // 1. Update local store immediately
  const localStore = readLocalMutationsStore();
  for (const item of localStore.jobTransfers) {
    if (
      item.recordId === params.recordId ||
      (params.rowNumber && item.rowNumber === params.rowNumber)
    ) {
      item.values['K'] = params.endTime;
      item.values['L'] = params.duration;
      item.values['M'] = finalStatus;
    }
  }
  writeLocalMutationsStore(localStore);

  // 2. Update backend store
  void fetch(`/api/mutations/job-transfer/${encodeURIComponent(params.recordId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rowNumber: params.rowNumber,
      endTime: params.endTime,
      duration: params.duration,
      status: finalStatus,
    }),
  }).catch(() => {});

  // 3. Write directly to Google Sheet via Apps Script Webhook (No-Login)
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'completeJobTransfer',
        recordId: params.recordId,
        rowNumber: params.rowNumber,
        endTime: params.endTime,
        duration: params.duration,
        status: finalStatus,
      });
      completedOnSheet = true;
      return { syncedToSheet: true };
    } catch {
      // fall through
    }
  }

  // 4. Write via Google Sheets API v4
  const token = await getOrConnectAccessToken(true);
  if (token) {
    try {
      const targetRow = await resolveJobTransferSheetRowNumber(
        token,
        params.rowNumber,
        params.recordId
      );
      if (targetRow >= 2) {
        const targetRange = encodeURIComponent(
          `บันทึกการย้ายงาน!K${targetRow}:M${targetRow}`
        );
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${targetRange}?valueInputOption=USER_ENTERED`;
        const response = await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [[params.endTime, params.duration, finalStatus]],
          }),
        });
        if (response.ok) {
          completedOnSheet = true;
        } else if (response.status === 401 || response.status === 403) {
          invalidateCachedToken();
        }
      }
    } catch {
      // ignore
    }
  }

  return { syncedToSheet: completedOnSheet };
}

export async function appendDeliveryPointRecord(
  payload: DeliveryPointPayload
): Promise<void> {
  const localStore = readLocalMutationsStore();
  localStore.deliveryPoints.push({
    id: Math.random().toString(16).slice(2, 10),
    rowNumber: 30 + localStore.deliveryPoints.length,
    values: {
      A: payload.date,
      B: payload.deliveryPoint,
      C: payload.gate,
    },
    createdAt: new Date().toISOString(),
  });
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/delivery-point', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: {
        A: payload.date,
        B: payload.deliveryPoint,
        C: payload.gate,
      },
    }),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'appendDeliveryPoint',
        date: payload.date,
        deliveryPoint: payload.deliveryPoint,
        gate: payload.gate,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = getSilentAccessToken();
  if (token) {
    try {
      const range = encodeURIComponent('จุดส่งสินค้า!A:A');
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[payload.date, payload.deliveryPoint, payload.gate]],
        }),
      });
    } catch {
      // ignore
    }
  }
}

export async function updateDeliveryPointGate(params: {
  deliveryPoint: string;
  oldGate: string;
  newGate: string;
  updatedDate: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  const editEntry: StoredDeliveryPointEdit = {
    deliveryPoint: params.deliveryPoint.trim(),
    oldGate: params.oldGate.trim(),
    newGate: params.newGate.trim(),
    updatedDate: params.updatedDate.trim(),
    updatedAt: new Date().toISOString(),
  };
  const existingIdx = localStore.deliveryPointEdits.findIndex(
    (e) => e.deliveryPoint === editEntry.deliveryPoint
  );
  if (existingIdx >= 0) {
    localStore.deliveryPointEdits[existingIdx] = editEntry;
  } else {
    localStore.deliveryPointEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/delivery-point-gate', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateDeliveryPointGate',
        ...params,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = getSilentAccessToken();
  if (token) {
    try {
      const readRange = encodeURIComponent('จุดส่งสินค้า!A:C');
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${readRange}`;
      const readRes = await fetch(readUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (readRes.ok) {
        const readJson = await readRes.json();
        const rows: string[][] = readJson?.values ?? [];
        let matchedIndex = -1;
        for (let i = 1; i < rows.length; i++) {
          if ((rows[i]?.[1] ?? '').trim() === params.deliveryPoint.trim()) {
            matchedIndex = i;
            break;
          }
        }
        if (matchedIndex !== -1) {
          const sheetRowNumber = matchedIndex + 1;
          const updateRange = encodeURIComponent(
            `จุดส่งสินค้า!A${sheetRowNumber}:C${sheetRowNumber}`
          );
          const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
          await fetch(updateUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: [
                [
                  params.updatedDate,
                  params.deliveryPoint.trim(),
                  params.newGate.trim(),
                ],
              ],
            }),
          });
        }
      }
    } catch {
      // ignore
    }
  }
}

export async function updateVehicleRegistration(params: {
  oldRegistration: string;
  newRegistration: string;
  driverName: string;
  shift: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  localStore.vehicleRegEdits.push({
    oldRegistration: params.oldRegistration.trim(),
    newRegistration: params.newRegistration.trim(),
    driverName: params.driverName.trim(),
    shift: params.shift.trim(),
    updatedAt: new Date().toISOString(),
  });
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/vehicle-registration', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateVehicleRegistration',
        ...params,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = getSilentAccessToken();
  if (token) {
    try {
      const readRange = encodeURIComponent('ฐานข้อมูลรถ!A:L');
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${readRange}`;
      const readRes = await fetch(readUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (readRes.ok) {
        const readJson = await readRes.json();
        const rows: string[][] = readJson?.values ?? [];
        let matchedIndex = -1;
        for (let i = 1; i < rows.length; i++) {
          if ((rows[i]?.[0] ?? '').trim() === params.oldRegistration.trim()) {
            matchedIndex = i;
            break;
          }
        }
        if (matchedIndex !== -1) {
          const sheetRowNumber = matchedIndex + 1;
          const updateRange = encodeURIComponent(`ฐานข้อมูลรถ!A${sheetRowNumber}`);
          const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
          await fetch(updateUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: [[params.newRegistration.trim()]],
            }),
          });
        }
      }
    } catch {
      // ignore
    }
  }
}

export async function updateVehicleField(params: {
  rowNumber: number;
  colId: string;
  newValue: string;
  oldRegistration?: string;
  driverName?: string;
  shift?: string;
}): Promise<string> {
  const cleanColId = params.colId.trim().toUpperCase();
  let cleanValue = params.newValue.trim();

  const localStore = readLocalMutationsStore();
  const existingIdx = localStore.vehicleFieldEdits.findIndex(
    (e) => e.rowNumber === params.rowNumber && e.colId === cleanColId
  );
  const entry: StoredVehicleFieldEdit = {
    rowNumber: params.rowNumber,
    colId: cleanColId,
    value: cleanValue,
    updatedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    localStore.vehicleFieldEdits[existingIdx] = entry;
  } else {
    localStore.vehicleFieldEdits.push(entry);
  }
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/vehicle-field', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rowNumber: params.rowNumber,
      colId: cleanColId,
      newValue: cleanValue,
    }),
  }).catch(() => {});

  if (
    cleanColId === 'A' &&
    params.oldRegistration &&
    params.oldRegistration.trim() &&
    params.oldRegistration.trim() !== cleanValue &&
    cleanValue
  ) {
    void updateVehicleRegistration({
      oldRegistration: params.oldRegistration.trim(),
      newRegistration: cleanValue,
      driverName: params.driverName ?? '',
      shift: params.shift ?? '',
    }).catch(() => {});
  }

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      const resp = (await callAppsScriptWebhook(scriptUrl, {
        action: 'updateVehicleField',
        rowNumber: params.rowNumber,
        colId: cleanColId,
        newValue: cleanValue,
      })) as { value?: string };
      if (resp && typeof resp.value === 'string' && resp.value.trim()) {
        cleanValue = resp.value.trim();
        entry.value = cleanValue;
        writeLocalMutationsStore(localStore);
        void fetch('/api/mutations/vehicle-field', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rowNumber: params.rowNumber,
            colId: cleanColId,
            newValue: cleanValue,
          }),
        }).catch(() => {});
      }
      return cleanValue;
    } catch {
      // fall through
    }
  }

  const token = getSilentAccessToken();
  if (token && params.rowNumber >= 1 && /^[A-Z]$/.test(cleanColId)) {
    try {
      const sheetRowNumber = params.rowNumber + 1;
      const updateRange = encodeURIComponent(
        `ฐานข้อมูลรถ!${cleanColId}${sheetRowNumber}`
      );
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
      await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[cleanValue]],
        }),
      });
    } catch {
      // ignore
    }
  }

  return cleanValue;
}

export async function updateJobTransferNote(params: {
  rowNumber: number;
  date: string;
  driverName: string;
  vehicleNumber: string;
  startTime: string;
  note: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  const editEntry: StoredJobTransferNoteEdit = {
    rowNumber: params.rowNumber,
    date: params.date.trim(),
    driverName: params.driverName.trim(),
    vehicleNumber: params.vehicleNumber.trim(),
    startTime: params.startTime.trim(),
    note: params.note.trim(),
    updatedAt: new Date().toISOString(),
  };
  const existingIdx = localStore.jobTransferNoteEdits.findIndex(
    (e) =>
      e.date === editEntry.date &&
      e.driverName === editEntry.driverName &&
      e.vehicleNumber === editEntry.vehicleNumber &&
      e.startTime === editEntry.startTime
  );
  if (existingIdx >= 0) {
    localStore.jobTransferNoteEdits[existingIdx] = editEntry;
  } else {
    localStore.jobTransferNoteEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/job-transfer-note', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateJobTransferNote',
        ...params,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = getSilentAccessToken();
  if (token) {
    try {
      const updateRange = encodeURIComponent(`บันทึกการย้ายงาน!N${params.rowNumber}`);
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
      await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[params.note.trim()]],
        }),
      });
    } catch {
      // ignore
    }
  }
}

async function fetchNextRepairSequenceAndRow(): Promise<{
  sequenceNo: string;
  rowNumber: number;
}> {
  let maxSeq = 4271;
  let sheetCount = 4271;
  try {
    const res = await queryGviz('944294225', 'select count(A), max(A)');
    const cVal = res.table?.rows?.[0]?.c?.[0]?.v;
    const mVal = res.table?.rows?.[0]?.c?.[1]?.v;
    if (typeof cVal === 'number' && cVal > 0) {
      sheetCount = cVal;
      if (cVal > maxSeq) maxSeq = cVal;
    }
    if (typeof mVal === 'number' && mVal > maxSeq) {
      maxSeq = mVal;
    }
  } catch {
    // ignore
  }

  const localStore = readLocalMutationsStore();
  for (const r of localStore.repairRequests) {
    const num = parseInt(r.sequenceNo, 10);
    if (!Number.isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = maxSeq + 1;
  return {
    sequenceNo: String(nextSeq),
    rowNumber: Math.max(sheetCount + 2, nextSeq + 1),
  };
}

export async function appendRepairRecord(
  payload: import('../types').RepairRequestPayload
): Promise<{ id: string; rowNumber: number; sequenceNo: string; syncedToSheet?: boolean }> {
  const id = Math.random().toString(16).slice(2, 10);
  const { sequenceNo, rowNumber: initialRowNumber } =
    await fetchNextRepairSequenceAndRow();
  let rowNumber = initialRowNumber;

  // Row values mapping 38 columns (A - AL)
  const rowValues: Array<string | number> = new Array(38).fill('');
  rowValues[0] = Number(sequenceNo) || sequenceNo; // A: ลำดับ
  rowValues[1] = payload.date; // B: วันที่แจ้งซ่อม
  rowValues[2] = payload.time; // C: เวลาแจงซ่อม
  rowValues[3] = payload.vehicleNumber; // D: เบอร์รถ
  rowValues[4] = payload.repairType; // E: ประเภทการซ่อม
  rowValues[5] = payload.symptoms; // F: อาการ
  rowValues[6] = payload.repairRequestNo || ''; // G: เลขที่ขอซ่อม
  rowValues[13] = payload.sparePartsCost || ''; // N: ค่าอะไหล่
  rowValues[14] = payload.laborCost || ''; // O: ค่าแรง
  rowValues[15] = 'รอตรวจสอบ'; // P: สถานะ
  // Q to Y: รูปถ่ายที่ 1 - 9 (indices 16 to 24)
  const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
  if (Array.isArray(payload.photos)) {
    payload.photos.slice(0, 9).forEach((photo, idx) => {
      rowValues[16 + idx] = photo;
    });
  }
  rowValues[26] = payload.reporterName; // AA: ผู้แจ้งซ่อม
  rowValues[33] = payload.note || ''; // AH: หมายเหตุ
  rowValues[34] = 'รอตรวจสอบ'; // AI: สถานะการอนุมัติ
  rowValues[35] = id; // AJ: ID

  const valuesMap: Record<string, string> = {
    A: sequenceNo,
    B: payload.date,
    C: payload.time,
    D: payload.vehicleNumber,
    E: payload.repairType,
    F: payload.symptoms,
    G: payload.repairRequestNo || '',
    N: payload.sparePartsCost || '',
    O: payload.laborCost || '',
    P: 'รอตรวจสอบ',
    AA: payload.reporterName,
    AH: payload.note || '',
    AI: 'รอตรวจสอบ',
    AJ: id,
  };

  if (Array.isArray(payload.photos)) {
    payload.photos.slice(0, 9).forEach((photo, idx) => {
      valuesMap[photoCols[idx]] = photo;
    });
  }

  let syncedToSheet = false;
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      const res = await callAppsScriptWebhook(scriptUrl, {
        action: 'appendRepairRequest',
        rowValues,
      });
      if (res.ok !== false) {
        syncedToSheet = true;
        if (res.rowNumber && res.rowNumber > 0) {
          rowNumber = res.rowNumber;
        }
        if (Array.isArray(res.photoUrls) && res.photoUrls.length > 0) {
          res.photoUrls.forEach((url, idx) => {
            if (url) {
              valuesMap[photoCols[idx]] = url;
            }
          });
        }
      }
    } catch {
      // fall through to Google Sheets API v4
    }
  }

  if (!syncedToSheet) {
    const token = await getOrConnectAccessToken(true);
    if (token) {
      try {
        const apiRowNumber = await postRepairRowToGoogleSheetsApi(rowValues, token);
        if (apiRowNumber && apiRowNumber > 0) {
          rowNumber = apiRowNumber;
        }
        syncedToSheet = true;
      } catch {
        // fall through to local/server persistence
      }
    }
  }

  const localStore = readLocalMutationsStore();
  localStore.repairRequests.push({
    id,
    rowNumber,
    sequenceNo,
    values: valuesMap,
    createdAt: new Date().toISOString(),
    syncedToSheet,
  });
  writeLocalMutationsStore(localStore);

  try {
    await fetch('/api/mutations/repair-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        rowNumber,
        sequenceNo,
        values: valuesMap,
        syncedToSheet,
      }),
    });
  } catch {
    // ignore
  }

  return { id, rowNumber, sequenceNo, syncedToSheet };
}

export async function approveRepairRecord(
  payload: import('../types').RepairApprovalPayload
): Promise<void> {
  const localStore = readLocalMutationsStore();
  const existingIdx = localStore.repairApprovals.findIndex(
    (a) =>
      (payload.sequenceNo && a.sequenceNo === payload.sequenceNo) ||
      (payload.rowNumber > 0 && a.rowNumber === payload.rowNumber)
  );

  const approvalEntry = {
    rowNumber: payload.rowNumber,
    sequenceNo: payload.sequenceNo,
    approvalStatus: payload.approvalStatus,
    approverName: payload.approverName,
    approvalDate: payload.approvalDate,
    approvalTime: payload.approvalTime,
    repairStatus: payload.repairStatus,
    note: payload.note,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    localStore.repairApprovals[existingIdx] = approvalEntry;
  } else {
    localStore.repairApprovals.push(approvalEntry);
  }
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/repair-approval', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'approveRepairRequest',
        ...payload,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = await getOrConnectAccessToken(true);
  if (token) {
    try {
      const targetRow = await resolveRepairSheetRowNumber(
        token,
        payload.rowNumber,
        payload.sequenceNo
      );
      if (targetRow >= 2) {
        const updateRange = encodeURIComponent(
          `บันทึกงานซ่อม!AE${targetRow}:AI${targetRow}`
        );
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
        await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [
              [
                payload.approverName,
                payload.approvalDate,
                payload.approvalTime,
                payload.note || '',
                payload.approvalStatus,
              ],
            ],
          }),
        });

        if (payload.repairStatus) {
          const statusRange = encodeURIComponent(`บันทึกงานซ่อม!P${targetRow}`);
          const statusUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${statusRange}?valueInputOption=USER_ENTERED`;
          await fetch(statusUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: [[payload.repairStatus]],
            }),
          });
        }
      }
    } catch {
      // ignore
    }
  }
}

export async function inspectRepairRecord(
  payload: import('../types').RepairInspectionPayload
): Promise<void> {
  const localStore = readLocalMutationsStore();
  for (const reqItem of localStore.repairRequests) {
    if (
      (payload.sequenceNo && reqItem.sequenceNo === payload.sequenceNo) ||
      (payload.repairRequestNo && reqItem.values['G'] === payload.repairRequestNo) ||
      (payload.rowNumber > 0 && reqItem.rowNumber === payload.rowNumber)
    ) {
      reqItem.values['AB'] = payload.inspectorName;
      reqItem.values['AC'] = payload.inspectionDate;
      reqItem.values['AD'] = payload.inspectionTime;
      reqItem.values['P'] = 'ตรวจสอบแล้ว';
      reqItem.values['AI'] = '2.⚠️รออนุมัติ';
      if (payload.sparePartsCost !== undefined) reqItem.values['N'] = payload.sparePartsCost;
      if (payload.laborCost !== undefined) reqItem.values['O'] = payload.laborCost;
      if (payload.note !== undefined && payload.note !== '') reqItem.values['AH'] = payload.note;
    }
  }

  const existingIdx = localStore.repairInspections.findIndex(
    (i) =>
      (payload.sequenceNo && i.sequenceNo === payload.sequenceNo) ||
      (payload.repairRequestNo && i.repairRequestNo === payload.repairRequestNo) ||
      (payload.rowNumber > 0 && i.rowNumber === payload.rowNumber)
  );

  const inspectionEntry: StoredRepairInspection = {
    rowNumber: payload.rowNumber,
    sequenceNo: payload.sequenceNo,
    repairRequestNo: payload.repairRequestNo,
    inspectorName: payload.inspectorName,
    inspectionDate: payload.inspectionDate,
    inspectionTime: payload.inspectionTime,
    sparePartsCost: payload.sparePartsCost,
    laborCost: payload.laborCost,
    note: payload.note,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    localStore.repairInspections[existingIdx] = inspectionEntry;
  } else {
    localStore.repairInspections.push(inspectionEntry);
  }
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/repair-inspection', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'inspectRepairRequest',
        ...payload,
      });
    } catch {
      // ignore
    }
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'approveRepairRequest',
        rowNumber: payload.rowNumber,
        sequenceNo: payload.sequenceNo,
        inspectorName: payload.inspectorName,
        inspectionDate: payload.inspectionDate,
        inspectionTime: payload.inspectionTime,
        approvalStatus: '2.⚠️รออนุมัติ',
        repairStatus: 'ตรวจสอบแล้ว',
        note: payload.note,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = await getOrConnectAccessToken(true);
  if (token) {
    try {
      const targetRow = await resolveRepairSheetRowNumber(
        token,
        payload.rowNumber,
        payload.sequenceNo
      );
      if (targetRow >= 2) {
        const inspRange = encodeURIComponent(
          `บันทึกงานซ่อม!AB${targetRow}:AD${targetRow}`
        );
        const inspUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${inspRange}?valueInputOption=USER_ENTERED`;
        await fetch(inspUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [
              [
                payload.inspectorName,
                payload.inspectionDate,
                payload.inspectionTime,
              ],
            ],
          }),
        });

        const statusRange = encodeURIComponent(`บันทึกงานซ่อม!P${targetRow}`);
        const statusUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${statusRange}?valueInputOption=USER_ENTERED`;
        await fetch(statusUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [['ตรวจสอบแล้ว']],
          }),
        });

        const appStatusRange = encodeURIComponent(`บันทึกงานซ่อม!AI${targetRow}`);
        const appStatusUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${appStatusRange}?valueInputOption=USER_ENTERED`;
        await fetch(appStatusUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [['2.⚠️รออนุมัติ']],
          }),
        });
      }
    } catch {
      // ignore
    }
  }
}

export async function updateRepairPhotos(
  payload: import('../types').RepairPhotoUpdatePayload
): Promise<void> {
  const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
  // Always normalize to 9 string elements so deleted photo slots are explicitly '' (never undefined)
  const normalizedPhotos: string[] = Array.from({ length: 9 }, (_, idx) =>
    String(payload.photos[idx] ?? '').trim()
  );

  // 1. Update local store across all 9 photo columns
  const localStore = readLocalMutationsStore();
  for (const reqItem of localStore.repairRequests) {
    if (
      (payload.sequenceNo && reqItem.sequenceNo === payload.sequenceNo) ||
      (payload.repairRequestNo && reqItem.values['G'] === payload.repairRequestNo) ||
      (payload.rowNumber > 0 && reqItem.rowNumber === payload.rowNumber)
    ) {
      photoCols.forEach((col, idx) => {
        reqItem.values[col] = normalizedPhotos[idx];
      });
    }
  }

  const existingIdx = localStore.repairPhotoEdits.findIndex(
    (p) =>
      (payload.sequenceNo && p.sequenceNo === payload.sequenceNo) ||
      (payload.repairRequestNo && p.repairRequestNo === payload.repairRequestNo) ||
      (payload.rowNumber > 0 && p.rowNumber === payload.rowNumber)
  );

  const editEntry: StoredRepairPhotoEdit = {
    rowNumber: payload.rowNumber,
    sequenceNo: payload.sequenceNo,
    repairRequestNo: payload.repairRequestNo,
    photos: normalizedPhotos,
    updatedAt: new Date().toISOString(),
    syncedToSheet: false,
  };

  if (existingIdx >= 0) {
    localStore.repairPhotoEdits[existingIdx] = editEntry;
  } else {
    localStore.repairPhotoEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  // 2. Persist to server store
  void fetch('/api/mutations/repair-photos', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      photos: normalizedPhotos,
    }),
  }).catch(() => {});

  // 3. Webhook update on existing row (sending all 9 slots so '' clears deleted cells in Google Sheets)
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      const res = await callAppsScriptWebhook(scriptUrl, {
        action: 'updateRepairPhotos',
        ...payload,
        photos: normalizedPhotos,
      });
      if (res.ok !== false && (!res.rowNumber || res.rowNumber >= 2)) {
        const updatedUrls = Array.isArray(res.photoUrls) && res.photoUrls.length > 0
          ? Array.from({ length: 9 }, (_, idx) => String(res.photoUrls![idx] ?? '').trim())
          : normalizedPhotos;

        for (const reqItem of localStore.repairRequests) {
          if (
            (payload.sequenceNo && reqItem.sequenceNo === payload.sequenceNo) ||
            (payload.repairRequestNo && reqItem.values['G'] === payload.repairRequestNo) ||
            (payload.rowNumber > 0 && reqItem.rowNumber === payload.rowNumber)
          ) {
            photoCols.forEach((col, idx) => {
              reqItem.values[col] = updatedUrls[idx];
            });
          }
        }
        const targetIdx = localStore.repairPhotoEdits.findIndex(
          (p) =>
            (payload.sequenceNo && p.sequenceNo === payload.sequenceNo) ||
            (payload.repairRequestNo && p.repairRequestNo === payload.repairRequestNo) ||
            (payload.rowNumber > 0 && p.rowNumber === payload.rowNumber)
        );
        if (targetIdx >= 0) {
          localStore.repairPhotoEdits[targetIdx].photos = updatedUrls;
          localStore.repairPhotoEdits[targetIdx].syncedToSheet = true;
          localStore.repairPhotoEdits[targetIdx].updatedAt = new Date().toISOString();
        }
        writeLocalMutationsStore(localStore);
        void fetch('/api/mutations/repair-photos', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            photos: updatedUrls,
            syncedToSheet: true,
          }),
        }).catch(() => {});
        return;
      }
    } catch {
      // fall through to Google Sheets REST API v4
    }
  }

  // 4. Update via Google Sheets API on exact existing row
  const token = await getOrConnectAccessToken(true);
  if (token) {
    try {
      const targetRow = await resolveRepairSheetRowNumber(
        token,
        payload.rowNumber,
        payload.sequenceNo,
        payload.repairRequestNo
      );
      if (targetRow >= 2) {
        const updateRange = encodeURIComponent(
          `บันทึกงานซ่อม!Q${targetRow}:Y${targetRow}`
        );
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
        const rowValues: string[] = normalizedPhotos.map((photo) =>
          photo && photo.length <= 48000 ? photo : ''
        );

        const putRes = await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [rowValues],
          }),
        });
        if (putRes.ok) {
          const targetIdx = localStore.repairPhotoEdits.findIndex(
            (p) =>
              (payload.sequenceNo && p.sequenceNo === payload.sequenceNo) ||
              (payload.repairRequestNo && p.repairRequestNo === payload.repairRequestNo) ||
              (payload.rowNumber > 0 && p.rowNumber === payload.rowNumber)
          );
          if (targetIdx >= 0) {
            localStore.repairPhotoEdits[targetIdx].syncedToSheet = true;
            localStore.repairPhotoEdits[targetIdx].updatedAt = new Date().toISOString();
            writeLocalMutationsStore(localStore);
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

export async function updateRepairAdditionalDetails(params: {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  additionalDetails: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  const editEntry: StoredRepairDetailEdit = {
    rowNumber: params.rowNumber,
    sequenceNo: params.sequenceNo.trim(),
    repairRequestNo: params.repairRequestNo?.trim() || '',
    additionalDetails: params.additionalDetails.trim(),
    updatedAt: new Date().toISOString(),
  };

  for (const reqItem of localStore.repairRequests) {
    if (
      (params.sequenceNo && reqItem.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && reqItem.values['G'] === params.repairRequestNo) ||
      (params.rowNumber > 0 && reqItem.rowNumber === params.rowNumber)
    ) {
      reqItem.values['AK'] = params.additionalDetails.trim();
    }
  }

  if (!localStore.repairDetailEdits) {
    localStore.repairDetailEdits = [];
  }

  const existingIdx = localStore.repairDetailEdits.findIndex(
    (e) =>
      (params.sequenceNo && e.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && e.repairRequestNo === params.repairRequestNo) ||
      (params.rowNumber > 0 && e.rowNumber === params.rowNumber)
  );

  if (existingIdx >= 0) {
    localStore.repairDetailEdits[existingIdx] = editEntry;
  } else {
    localStore.repairDetailEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  // 2. Persist to server store
  void fetch('/api/mutations/repair-details', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  // 3. Webhook update on existing row
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateRepairAdditionalDetails',
        ...params,
      });
      return;
    } catch {
      // fall through
    }
  }

  // 4. Update via Google Sheets API on exact existing row
  const token = await getOrConnectAccessToken(true);
  if (token) {
    try {
      const targetRow = await resolveRepairSheetRowNumber(
        token,
        params.rowNumber,
        params.sequenceNo,
        params.repairRequestNo
      );
      if (targetRow >= 2) {
        const updateRange = encodeURIComponent(`บันทึกงานซ่อม!AK${targetRow}`);
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
        await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [[params.additionalDetails.trim()]],
          }),
        });
      }
    } catch {
      // ignore
    }
  }
}

export async function updateRepairReplyDetails(params: {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  replyDetails: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  const editEntry: StoredRepairReplyEdit = {
    rowNumber: params.rowNumber,
    sequenceNo: params.sequenceNo.trim(),
    repairRequestNo: params.repairRequestNo?.trim() || '',
    replyDetails: params.replyDetails.trim(),
    updatedAt: new Date().toISOString(),
  };

  for (const reqItem of localStore.repairRequests) {
    if (
      (params.sequenceNo && reqItem.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && reqItem.values['G'] === params.repairRequestNo) ||
      (params.rowNumber > 0 && reqItem.rowNumber === params.rowNumber)
    ) {
      reqItem.values['AM'] = params.replyDetails.trim();
      if (params.replyDetails.trim()) {
        reqItem.values['AI'] = '4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว';
      }
    }
  }

  if (!localStore.repairReplyEdits) {
    localStore.repairReplyEdits = [];
  }

  const existingIdx = localStore.repairReplyEdits.findIndex(
    (e) =>
      (params.sequenceNo && e.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && e.repairRequestNo === params.repairRequestNo) ||
      (params.rowNumber > 0 && e.rowNumber === params.rowNumber)
  );

  if (existingIdx >= 0) {
    localStore.repairReplyEdits[existingIdx] = editEntry;
  } else {
    localStore.repairReplyEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  // 2. Persist to server store
  void fetch('/api/mutations/repair-reply', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  // 3. Webhook update on existing row
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateRepairReplyDetails',
        ...params,
      });
      return;
    } catch {
      // fall through
    }
  }

  // 4. Update via Google Sheets API on exact existing row
  const token = await getOrConnectAccessToken(true);
  if (token) {
    try {
      const targetRow = await resolveRepairSheetRowNumber(
        token,
        params.rowNumber,
        params.sequenceNo,
        params.repairRequestNo
      );
      if (targetRow >= 2) {
        const updateRange = encodeURIComponent(`บันทึกงานซ่อม!AM${targetRow}`);
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
        await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [[params.replyDetails.trim()]],
          }),
        });

        if (params.replyDetails.trim()) {
          const statusRange = encodeURIComponent(`บันทึกงานซ่อม!AI${targetRow}`);
          const statusUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${statusRange}?valueInputOption=USER_ENTERED`;
          await fetch(statusUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: [['4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว']],
            }),
          });
        }
      }
    } catch {
      // ignore
    }
  }
}

export async function updateRepairFinancialDetails(params: {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  sparePartsCost: string;
  laborCost: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  for (const req of localStore.repairRequests) {
    if (
      (params.sequenceNo && req.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && req.values['G'] === params.repairRequestNo) ||
      (params.rowNumber > 0 && req.rowNumber === params.rowNumber)
    ) {
      req.values['N'] = params.sparePartsCost;
      req.values['O'] = params.laborCost;
    }
  }

  if (!localStore.repairFinancialEdits) {
    localStore.repairFinancialEdits = [];
  }

  const editEntry: StoredRepairFinancialEdit = {
    rowNumber: params.rowNumber,
    sequenceNo: params.sequenceNo.trim(),
    repairRequestNo: params.repairRequestNo?.trim() || '',
    sparePartsCost: params.sparePartsCost.trim(),
    laborCost: params.laborCost.trim(),
    updatedAt: new Date().toISOString(),
  };

  const existingIdx = localStore.repairFinancialEdits.findIndex(
    (f) =>
      (params.sequenceNo && f.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && f.repairRequestNo === params.repairRequestNo) ||
      (params.rowNumber > 0 && f.rowNumber === params.rowNumber)
  );

  if (existingIdx >= 0) {
    localStore.repairFinancialEdits[existingIdx] = editEntry;
  } else {
    localStore.repairFinancialEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/repair-financial', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateRepairFinancialDetails',
        ...params,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = await getOrConnectAccessToken(true);
  if (token) {
    try {
      const targetRow = await resolveRepairSheetRowNumber(
        token,
        params.rowNumber,
        params.sequenceNo,
        params.repairRequestNo
      );
      if (targetRow >= 2) {
        const updateRange = encodeURIComponent(
          `บันทึกงานซ่อม!N${targetRow}:O${targetRow}`
        );
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
        await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [[params.sparePartsCost, params.laborCost]],
          }),
        });
      }
    } catch {
      // ignore
    }
  }
}

export async function appendFuelRecord(
  payload: FuelRecordPayload
): Promise<{ id: string; rowNumber: number | null }> {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const isReceive = payload.transactionType === 'รับเข้า';
  const litersInVal =
    isReceive && payload.litersIn !== undefined && payload.litersIn !== ''
      ? Number(payload.litersIn)
      : '';
  const priceVal =
    payload.pricePerLiter !== undefined && payload.pricePerLiter !== ''
      ? Number(payload.pricePerLiter)
      : '';
  const litersOutVal =
    !isReceive && payload.litersOut !== undefined && payload.litersOut !== ''
      ? Number(payload.litersOut)
      : '';
  const amountVal =
    payload.amountBaht !== undefined && payload.amountBaht !== ''
      ? Number(payload.amountBaht)
      : 0;
  const mileageVal =
    !isReceive && payload.mileage !== undefined && payload.mileage !== ''
      ? Number(payload.mileage)
      : '';

  const staffIssuerOrReceiver = isReceive
    ? (payload.receiverName || payload.issuerName || '').trim()
    : (payload.issuerName || '').trim();

  // Columns A..X of บันทึกน้ำมัน (gid: 1733355146)
  const rowValues: Array<string | number> = [
    id, // A: ID
    payload.date, // B: วันที่
    payload.time, // C: เวลา
    payload.fuelType, // D: ชนิดน้ำมัน
    litersInVal, // E: รับเข้า / ลิตร
    priceVal, // F: ราคา
    litersOutVal, // G: จ่ายออก /ลิตร
    amountVal, // H: มูลค่า / บาท
    payload.totalInDiesel, // I: รวมรับเข้า ดีเซล
    payload.totalInBenzene, // J: รวมรับเข้า เบนซิล
    payload.totalOutDiesel, // K: รวมเบิกออก ดีเซล
    payload.totalOutBenzene, // L: รวมเบิกออก เบนซิล
    payload.balanceDiesel, // M: คงเหลือ ดีเซล / ลิตร
    payload.balanceBenzene, // N: คงเหลือ เบนซิล / ลิตร
    isReceive ? '' : (payload.vehicleNumber || '').trim(), // O: เบอร์รถ
    mileageVal, // P: เลขไมล์
    isReceive ? '' : (payload.driverName || '').trim(), // Q: พนักงานขับรถ
    staffIssuerOrReceiver, // R: ผู้จ่ายน้ำมัน
    payload.transactionType, // S: STATUS (รับเข้า / เบิกออก)
    isReceive ? (payload.receiverName || staffIssuerOrReceiver) : '', // T: ผู้รับเข้า
    (payload.requisitionNo || '').trim(), // U: เลขที่ใบเบิก
    (payload.note || '').trim(), // V: หมายเหตุ
    '', // W: Update3
    payload.monthLabel, // X: MONTH
  ];

  const colLetters = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
    'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
    'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
  ];
  const valuesMap: Record<string, string> = {};
  colLetters.forEach((col, idx) => {
    const v = rowValues[idx];
    valuesMap[col] = v !== undefined && v !== null && v !== '' ? String(v) : '';
  });

  let rowNumber: number | null = null;
  let syncedToSheet = false;

  // 1. Try Google Apps Script Webhook
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      const res = await callAppsScriptWebhook(scriptUrl, {
        action: 'appendFuelRecord',
        rowValues,
      });
      if (res.ok !== false) {
        rowNumber = res.rowNumber ?? null;
        syncedToSheet = true;
      }
    } catch {
      // fall through
    }
  }

  // 2. Try Google Sheets REST API v4
  if (!syncedToSheet) {
    const token = await getOrConnectAccessToken(true);
    if (token) {
      try {
        const range = encodeURIComponent('บันทึกน้ำมัน!A:A');
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [rowValues],
          }),
        });
        if (response.ok) {
          syncedToSheet = true;
          try {
            const resJson = await response.json();
            const updatedRange: string = resJson?.updates?.updatedRange ?? '';
            const match = updatedRange.match(/![A-Z]+(\d+)/i);
            if (match && match[1]) {
              rowNumber = parseInt(match[1], 10);
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // fall through
      }
    }
  }

  // 3. Persist to local & backend store
  const currentSheetCount = await fetchSheetRowCount('1733355146');
  const localStore = readLocalMutationsStore();
  if (!localStore.fuelRecords) {
    localStore.fuelRecords = [];
  }
  const fallbackRowNumber =
    rowNumber ?? Math.max(currentSheetCount, 1) + localStore.fuelRecords.length + 1;

  localStore.fuelRecords.push({
    id,
    rowNumber: fallbackRowNumber,
    values: valuesMap,
    createdAt: new Date().toISOString(),
    syncedToSheet,
  });
  writeLocalMutationsStore(localStore);

  try {
    await fetch('/api/mutations/fuel-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        rowNumber: fallbackRowNumber,
        values: valuesMap,
        syncedToSheet,
      }),
    });
  } catch {
    // ignore
  }

  return { id, rowNumber: fallbackRowNumber };
}

export function normalizeDriverNameKey(rawName: string): string {
  return String(rawName || '')
    .replace(/^(นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let cachedAccountEmployeeMap: Map<string, string> | null = null;
let cachedAccountEmployeeMapAt = 0;

function parseSimpleCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export async function fetchAccountEmployeeMap(): Promise<Map<string, string>> {
  if (
    cachedAccountEmployeeMap &&
    cachedAccountEmployeeMap.size > 0 &&
    Date.now() - cachedAccountEmployeeMapAt < 60_000
  ) {
    return cachedAccountEmployeeMap;
  }

  const map = new Map<string, string>();

  const [accountCsvRes, transferEmpRes] = await Promise.allSettled([
    fetch(
      `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Account`
    ).then((r) => (r.ok ? r.text() : '')),
    queryGviz(
      '606634465',
      'select B, C where B is not null and C is not null group by B, C limit 500'
    ),
  ]);

  if (accountCsvRes.status === 'fulfilled' && accountCsvRes.value) {
    const lines = accountCsvRes.value.split(/\r?\n/).filter((l) => l.trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = parseSimpleCsvLine(lines[i]);
      const username = (cols[1] || '').trim();
      const fullName = (cols[3] || '').trim();
      const empCode = (cols[4] || username).trim();
      const key = normalizeDriverNameKey(fullName);
      if (key && empCode) {
        map.set(key, empCode);
      }
    }
  }

  if (
    transferEmpRes.status === 'fulfilled' &&
    transferEmpRes.value?.table?.rows
  ) {
    for (const r of transferEmpRes.value.table.rows) {
      const empCode = String(r.c?.[0]?.v ?? '').trim();
      const drvName = String(r.c?.[1]?.v ?? '').trim();
      const key = normalizeDriverNameKey(drvName);
      if (key && empCode && !map.has(key)) {
        map.set(key, empCode);
      }
    }
  }

  if (map.size > 0) {
    cachedAccountEmployeeMap = map;
    cachedAccountEmployeeMapAt = Date.now();
  }

  return map;
}

export async function appendTrailerRecord(trailerNumber: string): Promise<void> {
  const clean = (trailerNumber || '').trim();
  if (!clean) return;

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      const res = await callAppsScriptWebhook(scriptUrl, {
        action: 'appendTrailerRecord',
        trailerNumber: clean,
      });
      if (res.ok !== false) return;
    } catch {
      // fall through to REST API
    }
  }

  const token = await getOrConnectAccessToken(false);
  if (token) {
    try {
      const range = encodeURIComponent('ฐานข้อมูลหาง!A:A');
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[clean]],
        }),
      });
    } catch {
      // ignore background error
    }
  }
}

