import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  SlidersHorizontal,
  ExternalLink,
  AlertCircle,
  Plus,
  CheckCircle2,
  Menu,
  Pencil,
  Check,
  Link2,
  Wrench,
  CheckCircle,
  Calendar,
  Camera,
  Eye,
  Home,
  Fuel,
  Scale,
  Truck,
  Repeat,
  Coins,
  Clock,
  Droplet,
  Bell,
} from 'lucide-react';
import {
  GOOGLE_SHEET_ID,
  SHEET_TABS,
  fetchSheetTabData,
  updateDeliveryPointGate,
  updateVehicleRegistration,
  updateVehicleField,
  updateJobTransferNote,
  updateRepairAdditionalDetails,
  updateRepairReplyDetails,
  updateRepairFinancialDetails,
  inspectRepairRecord,
  isPhotoValue,
} from './services/googleSheets';
import { SheetColumn, SheetDataResult, SheetRow, SheetTabConfig } from './types';
import { RecordDetailModal } from './components/RecordDetailModal';
import { JobTransferModal } from './components/JobTransferModal';
import { DeliveryPointModal } from './components/DeliveryPointModal';
import { SheetWebhookModal } from './components/SheetWebhookModal';
import { RepairRequestModal } from './components/RepairRequestModal';
import { ManagerApprovalModal } from './components/ManagerApprovalModal';
import { AttachRepairPhotosModal } from './components/AttachRepairPhotosModal';
import { FuelRecordModal } from './components/FuelRecordModal';
import { DrivePhotoImg } from './components/DrivePhotoImg';
import { PWAInstallButton } from './components/PWAInstallButton';
import { APP_VERSION } from './version';
import { showSuccessToast } from './utils/swal';
import {
  getGroupHeaderTheme,
  getJobTransferStatusPriority,
  sortJobTransferGroups,
} from './utils/groupHelpers';

const PAGE_SIZE = 30;

function isDurationExceeding20Minutes(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return false;
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds > 20 * 60;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds > 20 * 60;
  }
  return false;
}

function parseThaiDateToTimestamp(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);
  // Convert Buddhist Era (พ.ศ.) to Common Era (ค.ศ.)
  if (year > 2400) {
    year -= 543;
  }
  return new Date(year, month - 1, day).setHours(0, 0, 0, 0);
}

function parseIsoInputDateToTimestamp(isoDate: string): number | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).setHours(0, 0, 0, 0);
}

function calculatePendingApprovalCount(rows: SheetRow[]): number {
  return rows.filter((r) => {
    const st = getRowApprovalStatus(r);
    return (
      st === 'รออนุมัติ' ||
      st === 'ตอบกลับข้อมูลเพิ่มเติมแล้ว' ||
      st === 'ขอข้อมูลเพิ่มเติม' ||
      st === 'รอพิจารณา'
    );
  }).length;
}

const REPAIR_STATUS_GROUP_ORDER: string[] = [
  'รอตรวจสอบ',
  'รออนุมัติ',
  'ขอข้อมูลเพิ่มเติม',
  'ตอบกลับข้อมูลเพิ่มเติมแล้ว',
  'อนุมัติ',
  'ไม่อนุมัติ',
];

function getRowApprovalStatus(row: SheetRow): string {
  const appStatus = (row.values['AI'] ?? '').trim();
  const repairStatus = (row.values['P'] ?? '').trim();
  const inspector = (row.values['AB'] ?? '').trim();
  const replyText = (row.values['AM'] ?? '').trim();

  if (
    appStatus === 'รอตรวจสอบ' ||
    repairStatus === 'รอตรวจสอบ' ||
    (!appStatus && !inspector)
  ) {
    return 'รอตรวจสอบ';
  }
  if (appStatus.includes('ไม่อนุมัติ')) return 'ไม่อนุมัติ';
  if (
    appStatus.includes('อนุมัติ') &&
    !appStatus.includes('ไม่อนุมัติ') &&
    !appStatus.includes('รอ') &&
    !appStatus.includes('ตอบกลับ')
  ) {
    return 'อนุมัติ';
  }
  const isReplied = appStatus.includes('ตอบกลับ') || Boolean(replyText);
  if (isReplied) return 'ตอบกลับข้อมูลเพิ่มเติมแล้ว';
  if (appStatus.includes('ขอข้อมูล')) return 'ขอข้อมูลเพิ่มเติม';
  if (
    !appStatus ||
    appStatus.includes('รออนุมัติ') ||
    appStatus.includes('รอพิจารณา') ||
    appStatus.includes('รอ')
  ) {
    return 'รออนุมัติ';
  }
  return appStatus.replace(/^\d+\.\s*/, '').trim();
}

function getRowJobTransferStatus(row: SheetRow, columns?: SheetColumn[]): string {
  const statusCol = columns?.find((c) => c.label.trim() === 'สถานะ');
  const raw = (statusCol ? row.values[statusCol.id] : row.values['M']) ?? row.values['M'] ?? '';
  const trimmed = raw.trim();
  if (trimmed === 'อยู่ระว่างการส่ง') return 'อยู่ระหว่างการส่ง';
  return trimmed || 'ไม่ระบุสถานะ';
}

function getRowVehicleShift(row: SheetRow, columns?: SheetColumn[]): string {
  const shiftCol = columns?.find(
    (c) => c.label.trim() === 'กะทำงาน' || c.label.trim() === 'กะ'
  );
  const raw = (shiftCol ? row.values[shiftCol.id] : row.values['L']) ?? row.values['L'] ?? '';
  const trimmed = raw.trim();
  return trimmed ? `กะ: ${trimmed}` : 'ไม่ระบุกะทำงาน';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<SheetTabConfig>(SHEET_TABS[0]);
  const [sheetData, setSheetData] = useState<SheetDataResult | null>(null);
  const [repairTabRows, setRepairTabRows] = useState<SheetRow[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState<number>(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [groupPages, setGroupPages] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedColumnId, setSelectedColumnId] = useState<string>('ALL');
  const [quickFilterValue, setQuickFilterValue] = useState<string>('ALL');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [rowLimit, setRowLimit] = useState<number>(SHEET_TABS[0].defaultLimit ?? 250);
  const [deepSearchTerm, setDeepSearchTerm] = useState<string>('');

  // Auto-refresh interval in seconds (0 = off)
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(30);

  // Sorting & Pagination
  const [sortConfig, setSortConfig] = useState<{
    colId: string;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Selected row for detail modal
  const [selectedRow, setSelectedRow] = useState<SheetRow | null>(null);

  // Job Transfer & Delivery Point creation modals
  const [isJobModalOpen, setIsJobModalOpen] = useState<boolean>(false);
  const [isDeliveryPointModalOpen, setIsDeliveryPointModalOpen] = useState<boolean>(false);
  const [isFuelModalOpen, setIsFuelModalOpen] = useState<boolean>(false);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState<boolean>(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState<boolean>(false);
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState<boolean>(false);
  const [attachingPhotoRow, setAttachingPhotoRow] = useState<SheetRow | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Inline editing state for จุดส่งสินค้า -> คอลัมน์ ประตู, ฐานข้อมูลรถ -> คอลัมน์ ทะเบียนรถ, และ บันทึกงานซ่อม -> คอลัมน์ รายละเอียดเพิ่มเติม / ตอบกลับข้อมูลเพิ่มเติม
  const [editingGateRowNumber, setEditingGateRowNumber] = useState<number | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingGateValue, setEditingGateValue] = useState<string>('');
  const [confirmingGateRowNumber, setConfirmingGateRowNumber] = useState<number | null>(
    null
  );
  const [isUpdatingGate, setIsUpdatingGate] = useState<boolean>(false);

function playNotificationChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.15);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.35);
    gain2.gain.setValueAtTime(0.35, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);
  } catch {
    // ignore
  }
}

  const [notificationPermission, setNotificationPermission] = useState<string>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default'
  );
  const [newRepairToast, setNewRepairToast] = useState<{
    vehicle: string;
    symptom: string;
    reporter: string;
  } | null>(null);

  const seenRepairIdsRef = useRef<Set<string>>(new Set());
  const isInitialRepairLoadRef = useRef<boolean>(true);

  const handleUpdateRepairRows = useCallback((rows: SheetRow[]) => {
    setRepairTabRows(rows);
    setPendingApprovalCount(calculatePendingApprovalCount(rows));

    if (rows.length === 0) return;

    if (isInitialRepairLoadRef.current) {
      rows.forEach((r) => {
        const key = String(r.values['A'] || r.rowNumber);
        seenRepairIdsRef.current.add(key);
      });
      isInitialRepairLoadRef.current = false;
    } else {
      const newItems: SheetRow[] = [];
      rows.forEach((r) => {
        const key = String(r.values['A'] || r.rowNumber);
        if (!seenRepairIdsRef.current.has(key)) {
          seenRepairIdsRef.current.add(key);
          newItems.push(r);
        }
      });

      if (newItems.length > 0) {
        const latestNew = newItems[0];
        const vehicle =
          latestNew.values['D'] ||
          latestNew.values['O'] ||
          latestNew.values['vehicleNumber'] ||
          'ไม่ระบุเบอร์รถ';
        const symptom =
          latestNew.values['F'] ||
          latestNew.values['symptoms'] ||
          latestNew.values['E'] ||
          'แจ้งซ่อมใหม่';
        const reporter =
          latestNew.values['AA'] || latestNew.values['reporterName'] || '';

        setNewRepairToast({ vehicle, symptom, reporter });
        playNotificationChime();

        if ('Notification' in window && Notification.permission === 'granted') {
          const title = `🔔 มีรายการแจ้งซ่อมใหม่! (${vehicle})`;
          const body = `อาการ: ${symptom}${reporter ? ` | ผู้แจ้ง: ${reporter}` : ''}`;
          try {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
              void navigator.serviceWorker.ready.then((reg) => {
                void reg.showNotification(title, {
                  body,
                  icon: '/pwa-192x192.png',
                  tag: `repair-${latestNew.rowNumber}`,
                });
              });
            } else {
              new Notification(title, {
                body,
                icon: '/pwa-192x192.png',
              });
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }, []);

  const handleToggleMobileNotifications = async () => {
    if (!('Notification' in window)) {
      alert('เบราว์เซอร์นี้ไม่รองรับระบบการแจ้งเตือนบนหน้าจอ');
      return;
    }

    try {
      const res = await Notification.requestPermission();
      setNotificationPermission(res);
      if (res === 'granted') {
        playNotificationChime();
        const title = '🔔 เปิดการแจ้งเตือนงานซ่อมเรียบร้อย';
        const body =
          'ระบบจะส่งการแจ้งเตือนเด้งไปที่หน้าจอมือถือทันทีเมื่อมีรายการแจ้งซ่อมใหม่';
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          const reg = await navigator.serviceWorker.ready;
          void reg.showNotification(title, { body, icon: '/pwa-192x192.png' });
        } else {
          new Notification(title, { body, icon: '/pwa-192x192.png' });
        }
      } else if (res === 'denied') {
        alert(
          'สิทธิ์การแจ้งเตือนถูกปฏิเสธ กรุณาอนุญาตการแจ้งเตือนในการตั้งค่าเบราว์เซอร์ของมือถือ'
        );
      }
    } catch {
      // ignore
    }
  };

  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  const loadData = useCallback(
    async (options?: { silent?: boolean; remoteSearch?: string }) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      isFetchingRef.current = true;

      if (options?.silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const result = await fetchSheetTabData(activeTab, {
          limit: rowLimit,
          remoteSearchQuery: options?.remoteSearch ?? deepSearchTerm,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setSheetData(result);
        setIsLoading(false);
        setIsRefreshing(false);

        if (activeTab.gid === '944294225') {
          handleUpdateRepairRows(result.rows);
        } else {
          const repairTabConfig = SHEET_TABS.find((t) => t.gid === '944294225');
          if (repairTabConfig) {
            void fetchSheetTabData(repairTabConfig, {
              limit: 250,
            })
              .then((repairRes) => {
                if (!controller.signal.aborted) {
                  handleUpdateRepairRows(repairRes.rows);
                }
              })
              .catch(() => {});
          }
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : 'เกิดข้อผิดพลาดในการดึงข้อมูลจาก Google Sheets'
        );
      } finally {
        if (abortControllerRef.current === controller) {
          isFetchingRef.current = false;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [activeTab, rowLimit, deepSearchTerm]
  );

  // Initial load and when activeTab / rowLimit / deepSearchTerm changes
  useEffect(() => {
    loadData({ silent: false });
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadData]);

  // Real-time polling
  useEffect(() => {
    if (refreshIntervalSec <= 0) return;
    const timer = setInterval(() => {
      if (isFetchingRef.current) return;
      loadData({ silent: true });
    }, refreshIntervalSec * 1000);
    return () => clearInterval(timer);
  }, [refreshIntervalSec, loadData]);

  const handleSelectTab = (tab: SheetTabConfig) => {
    setIsSidebarOpen(false);
    if (tab.gid === activeTab.gid) return;
    setActiveTab(tab);
    setRowLimit(tab.defaultLimit ?? 250);
    setSearchQuery('');
    setDeepSearchTerm('');
    setSelectedColumnId('ALL');
    setQuickFilterValue('ALL');
    setStartDateFilter('');
    setEndDateFilter('');
    setSortConfig(null);
    setCurrentPage(1);
    setCollapsedGroups({});
    setGroupPages({});
    setEditingGateRowNumber(null);
    setEditingColumnId(null);
    setConfirmingGateRowNumber(null);
  };

  const handleConfirmGateUpdate = async (row: SheetRow) => {
    const newValue = editingGateValue.trim();
    const isVehicleTab = activeTab.gid === '378250263';
    const isJobTransferTab = activeTab.gid === '606634465';
    const isRepairTab = activeTab.gid === '944294225';
    const oldValue = isVehicleTab
      ? (row.values['A'] ?? '').trim()
      : isJobTransferTab
        ? (row.values['N'] ?? '').trim()
        : isRepairTab
          ? (row.values['AK'] ?? '').trim()
          : (row.values['C'] ?? '').trim();

    if (!isJobTransferTab && !isRepairTab && !newValue) return;
    if (newValue === oldValue) {
      setEditingGateRowNumber(null);
      setConfirmingGateRowNumber(null);
      return;
    }

    setIsUpdatingGate(true);
    setError(null);

    try {
      if (isRepairTab) {
        const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
        const repairRequestNo = (row.values['G'] ?? '').trim();

        if (editingColumnId === 'AM' || editingColumnId === 'ตอบกลับข้อมูลเพิ่มเติม') {
          await updateRepairReplyDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            replyDetails: newValue,
          });

          // Update local row immediately
          row.values['AM'] = newValue;

          setEditingGateRowNumber(null);
          setEditingColumnId(null);
          setConfirmingGateRowNumber(null);
          const msg = newValue
            ? `บันทึกการตอบกลับข้อมูลเพิ่มเติมเรียบร้อยแล้ว`
            : `ล้างการตอบกลับข้อมูลเพิ่มเติมเรียบร้อยแล้ว`;
          setSaveSuccessMsg(msg);
          showSuccessToast('บันทึกการตอบกลับสำเร็จ!', msg);
        } else {
          await updateRepairAdditionalDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            additionalDetails: newValue,
          });

          // Update local row immediately
          row.values['AK'] = newValue;

          setEditingGateRowNumber(null);
          setEditingColumnId(null);
          setConfirmingGateRowNumber(null);
          const msg = newValue
            ? `บันทึกรายละเอียดเพิ่มเติมเรียบร้อยแล้ว`
            : `ล้างรายละเอียดเพิ่มเติมเรียบร้อยแล้ว`;
          setSaveSuccessMsg(msg);
          showSuccessToast('บันทึกรายละเอียดเพิ่มเติมสำเร็จ!', msg);
        }
      } else if (isJobTransferTab) {
        const date = (row.values['A'] ?? '').trim();
        const driverName = (row.values['C'] ?? '').trim();
        const vehicleNumber = (row.values['D'] ?? '').trim();
        const startTime = (row.values['I'] ?? '').trim();

        await updateJobTransferNote({
          rowNumber: row.rowNumber,
          date,
          driverName,
          vehicleNumber,
          startTime,
          note: newValue,
        });

        setEditingGateRowNumber(null);
        setConfirmingGateRowNumber(null);
        const msg = newValue
          ? `บันทึกหมายเหตุเรียบร้อยแล้ว`
          : `ล้างหมายเหตุเรียบร้อยแล้ว`;
        setSaveSuccessMsg(msg);
        showSuccessToast('บันทึกหมายเหตุสำเร็จ!', msg);
      } else if (isVehicleTab) {
        const driverName = (row.values['I'] ?? '').trim();
        const shift = (row.values['L'] ?? '').trim();

        await updateVehicleRegistration({
          oldRegistration: oldValue,
          newRegistration: newValue,
          driverName,
          shift,
        });

        setEditingGateRowNumber(null);
        setConfirmingGateRowNumber(null);
        const msg = `อัปเดตทะเบียนรถจาก "${oldValue}" เป็น "${newValue}" เรียบร้อยแล้ว`;
        setSaveSuccessMsg(msg);
        showSuccessToast('อัปเดตทะเบียนรถสำเร็จ!', msg);
      } else {
        const deliveryPoint = (row.values['B'] ?? '').trim();
        const now = new Date();
        const updatedDate = `${now.getDate()}/${now.getMonth() + 1}/${
          now.getFullYear() + 543
        }`;

        await updateDeliveryPointGate({
          deliveryPoint,
          oldGate: oldValue,
          newGate: newValue,
          updatedDate,
        });

        setEditingGateRowNumber(null);
        setConfirmingGateRowNumber(null);
        const msg = `อัปเดตประตูของจุดส่งสินค้า ${deliveryPoint} เป็น "${newValue}" เรียบร้อยแล้ว`;
        setSaveSuccessMsg(msg);
        showSuccessToast('อัปเดตข้อมูลสำเร็จ!', msg);
      }

      loadData({ silent: true });
      setTimeout(() => {
        setSaveSuccessMsg(null);
      }, 5000);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล'
      );
    } finally {
      setIsUpdatingGate(false);
    }
  };

  // Detect primary status/category column for quick filter buttons
  const quickFilterColumn = useMemo<SheetColumn | null>(() => {
    if (!sheetData) return null;
    const candidates = [
      'สถานะ',
      'สถานะการใช้งาน',
      'สถานะการอนุมัติ',
      'ประเภทสินค้า',
      'ประเภทรถ',
      'ประเภทการซ่อม',
      'STATUS',
      'ครบรอบPM',
      'ยี่ห้อ',
      'จุดส่งสินค้า',
    ];
    for (const label of candidates) {
      const found = sheetData.columns.find((c) => c.label.trim() === label);
      if (found) return found;
    }
    return null;
  }, [sheetData]);

  const quickFilterOptions = useMemo<string[]>(() => {
    if (activeTab.gid === '944294225') {
      return [
        'รอตรวจสอบ',
        'รอคิวซ่อม',
        'ซ่อมเสร็จแล้ว',
        'กำลังซ่อม',
        'ตรวจสอบแล้ว',
        'ผู้ใช้งานแจ้งซ่อม',
        'รออะไหล่',
        'รอข้อมูลเพิ่มเติม',
      ];
    }
    if (!sheetData || !quickFilterColumn) return [];
    const counts = new Map<string, number>();
    sheetData.rows.forEach((row) => {
      const val = row.values[quickFilterColumn.id]?.trim();
      if (val) {
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([val]) => val);
  }, [sheetData, quickFilterColumn, activeTab.gid]);

  // Filter rows by date range, search query, selected column, and quick filter
  const filteredRows = useMemo<SheetRow[]>(() => {
    if (!sheetData) return [];
    const q = searchQuery.trim().toLowerCase();
    const startTs = parseIsoInputDateToTimestamp(startDateFilter);
    const endTs = parseIsoInputDateToTimestamp(endDateFilter);

    // Identify primary date column (Col A for บันทึกการย้ายงาน or any column with 'วัน' or 'date')
    const dateCol =
      sheetData.columns.find((c) => c.id === 'A' && (c.type === 'date' || c.label.includes('วัน'))) ||
      sheetData.columns.find((c) => c.label.includes('วันที่') || c.type === 'date');

    return sheetData.rows.filter((row) => {
      // Date range filtering
      if (startTs !== null || endTs !== null) {
        const rawDateStr = dateCol ? (row.values[dateCol.id] ?? '') : (row.values['A'] ?? '');
        const rowTs = parseThaiDateToTimestamp(rawDateStr);
        if (rowTs !== null) {
          if (startTs !== null && rowTs < startTs) return false;
          if (endTs !== null && rowTs > endTs) return false;
        }
      }

      if (quickFilterValue !== 'ALL') {
        if (activeTab.gid === '944294225') {
          const statusVal = (row.values['P'] ?? '').trim();
          const reporterVal = (row.values['AA'] ?? '').trim();
          const detailVal = (row.values['AK'] ?? '').trim();
          const appVal = (row.values['AI'] ?? '').trim();

          if (quickFilterValue === 'รอตรวจสอบ') {
            if (getRowApprovalStatus(row) !== 'รอตรวจสอบ' && statusVal !== 'รอตรวจสอบ' && appVal !== 'รอตรวจสอบ') return false;
          } else if (quickFilterValue === 'ผู้ใช้งานแจ้งซ่อม') {
            if (!reporterVal) return false;
          } else if (quickFilterValue === 'รอข้อมูลเพิ่มเติม') {
            if (!statusVal.includes('ข้อมูลเพิ่มเติม') && !detailVal && !appVal.includes('ข้อมูลเพิ่มเติม')) return false;
          } else {
            if (!statusVal.includes(quickFilterValue) && !appVal.includes(quickFilterValue)) return false;
          }
        } else if (
          quickFilterColumn &&
          row.values[quickFilterColumn.id]?.trim() !== quickFilterValue
        ) {
          return false;
        }
      }

      if (!q) return true;

      if (selectedColumnId !== 'ALL') {
        const cellVal = (row.values[selectedColumnId] ?? '').toLowerCase();
        return cellVal.includes(q);
      }

      // Search across row number and all columns
      if (String(row.rowNumber).includes(q)) return true;
      return (sheetData.allColumns ?? sheetData.columns).some((col) =>
        (row.values[col.id] ?? '').toLowerCase().includes(q)
      );
    });
  }, [
    sheetData,
    searchQuery,
    selectedColumnId,
    quickFilterValue,
    quickFilterColumn,
    startDateFilter,
    endDateFilter,
  ]);

  // Sort filtered rows
  const sortedRows = useMemo<SheetRow[]>(() => {
    if (!sortConfig || !sheetData) return filteredRows;
    const { colId, direction } = sortConfig;
    const col = sheetData.columns.find((c) => c.id === colId);

    return [...filteredRows].sort((a, b) => {
      if (colId === '__ROW__') {
        return direction === 'asc'
          ? a.rowNumber - b.rowNumber
          : b.rowNumber - a.rowNumber;
      }

      const rawA = a.rawValues[colId];
      const rawB = b.rawValues[colId];

      if (typeof rawA === 'number' && typeof rawB === 'number') {
        return direction === 'asc' ? rawA - rawB : rawB - rawA;
      }

      const strA = a.values[colId] ?? '';
      const strB = b.values[colId] ?? '';

      if (col?.type === 'number') {
        const numA = parseFloat(strA.replace(/,/g, ''));
        const numB = parseFloat(strB.replace(/,/g, ''));
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
          return direction === 'asc' ? numA - numB : numB - numA;
        }
      }

      const cmp = strA.localeCompare(strB, 'th');
      return direction === 'asc' ? cmp : -cmp;
    });
  }, [filteredRows, sortConfig, sheetData]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    selectedColumnId,
    quickFilterValue,
    activeTab.gid,
    startDateFilter,
    endDateFilter,
  ]);

  const effectivePageSize = activeTab.gid === '378250263' ? 50 : PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / effectivePageSize));
  const paginatedRows = useMemo<SheetRow[]>(() => {
    const start = (currentPage - 1) * effectivePageSize;
    return sortedRows.slice(start, start + effectivePageSize);
  }, [sortedRows, currentPage, effectivePageSize]);

  const repairGroupedRows = useMemo(() => {
    if (
      activeTab.gid !== '944294225' &&
      activeTab.gid !== '606634465' &&
      activeTab.gid !== '378250263'
    ) {
      return null;
    }
    const tempGroups = new Map<string, SheetRow[]>();
    sortedRows.forEach((row) => {
      const status =
        activeTab.gid === '944294225'
          ? getRowApprovalStatus(row)
          : activeTab.gid === '378250263'
          ? getRowVehicleShift(row, sheetData?.columns)
          : getRowJobTransferStatus(row, sheetData?.columns);
      if (!tempGroups.has(status)) {
        tempGroups.set(status, []);
      }
      tempGroups.get(status)!.push(row);
    });

    if (activeTab.gid === '944294225') {
      const orderedGroups = new Map<string, SheetRow[]>();
      REPAIR_STATUS_GROUP_ORDER.forEach((statusKey) => {
        const rowsForStatus = tempGroups.get(statusKey);
        if (rowsForStatus && rowsForStatus.length > 0) {
          orderedGroups.set(statusKey, rowsForStatus);
        }
      });
      tempGroups.forEach((rowsForStatus, statusKey) => {
        if (!orderedGroups.has(statusKey)) {
          orderedGroups.set(statusKey, rowsForStatus);
        }
      });
      return orderedGroups;
    }

    if (activeTab.gid === '606634465') {
      const sortedEntries = sortJobTransferGroups(Array.from(tempGroups.entries()));
      const orderedJobGroups = new Map<string, SheetRow[]>();
      sortedEntries.forEach(([statusKey, rowsForStatus]) => {
        orderedJobGroups.set(statusKey, rowsForStatus);
      });
      return orderedJobGroups;
    }

    return tempGroups;
  }, [sortedRows, activeTab.gid, sheetData?.columns]);

  useEffect(() => {
    if (repairGroupedRows) {
      setCollapsedGroups((prev) => {
        const next = { ...prev };
        repairGroupedRows.forEach((_, status) => {
          if (next[status] === undefined) {
            next[status] = true; // collapsed by default
          }
        });
        return next;
      });
    }
  }, [repairGroupedRows]);

  // Contextual real-time summary metric based on actual columns in current sheet
  const contextualMetric = useMemo<{ label: string; value: string; subtext: string }>(() => {
    if (!sheetData || filteredRows.length === 0) {
      return {
        label: 'คอลัมน์ข้อมูลที่ใช้งาน',
        value: sheetData ? `${sheetData.columns.length}` : '0',
        subtext: 'คอลัมน์ในตารางปัจจุบัน',
      };
    }

    // Check if there is a weight column ('น้ำหนัก')
    const weightCol = sheetData.columns.find((c) => c.label.trim() === 'น้ำหนัก');
    if (weightCol) {
      let totalWeight = 0;
      filteredRows.forEach((r) => {
        const raw = r.rawValues[weightCol.id];
        if (typeof raw === 'number') {
          totalWeight += raw;
        } else {
          const parsed = parseFloat((r.values[weightCol.id] ?? '').replace(/,/g, ''));
          if (!Number.isNaN(parsed)) totalWeight += parsed;
        }
      });
      return {
        label: 'น้ำหนักรวมรายการที่แสดง',
        value: `${totalWeight.toLocaleString('th-TH', { maximumFractionDigits: 0 })} กก.`,
        subtext: `คำนวณจาก ${filteredRows.length.toLocaleString('th-TH')} รายการ`,
      };
    }

    // Check if there is a remaining stock column ('คงเหลือ')
    const remainCol = sheetData.columns.find((c) => c.label.trim() === 'คงเหลือ');
    if (remainCol) {
      let totalRemain = 0;
      filteredRows.forEach((r) => {
        const raw = r.rawValues[remainCol.id];
        if (typeof raw === 'number') {
          totalRemain += raw;
        } else {
          const parsed = parseFloat((r.values[remainCol.id] ?? '').replace(/,/g, ''));
          if (!Number.isNaN(parsed)) totalRemain += parsed;
        }
      });
      return {
        label: 'ยอดคงเหลือรวมในคลัง',
        value: `${totalRemain.toLocaleString('th-TH')} ชิ้น/เส้น`,
        subtext: `จากรายการอะไหล่ ${filteredRows.length.toLocaleString('th-TH')} รายการ`,
      };
    }

    // Otherwise count top status value if quickFilterColumn exists
    if (quickFilterColumn) {
      const topValue = quickFilterOptions[0];
      if (topValue) {
        const count = filteredRows.filter(
          (r) => r.values[quickFilterColumn.id]?.trim() === topValue
        ).length;
        return {
          label: `${quickFilterColumn.label}: ${topValue}`,
          value: `${count.toLocaleString('th-TH')} รายการ`,
          subtext: `คิดเป็น ${Math.round((count / filteredRows.length) * 100)}% ของข้อมูลที่แสดง`,
        };
      }
    }

    return {
      label: 'คอลัมน์ข้อมูลที่ใช้งาน',
      value: `${sheetData.columns.length} คอลัมน์`,
      subtext: `ตาราง ${sheetData.tabName}`,
    };
  }, [sheetData, filteredRows, quickFilterColumn, quickFilterOptions]);

  // Real-time KPI summary cards specifically for הבันทึกการย้ายงาน (gid: 606634465)
  const jobTransferKpiMetrics = useMemo(() => {
    const weightColId =
      sheetData?.columns.find((c) => c.label.trim() === 'น้ำหนัก')?.id ?? 'G';
    const vehColId =
      sheetData?.columns.find((c) => c.label.trim() === 'เบอร์รถ')?.id ?? 'D';
    const driverColId =
      sheetData?.columns.find((c) => c.label.trim() === 'ชื่อพนักงานขับรถ')?.id ??
      'C';
    const statusColId =
      sheetData?.columns.find((c) => c.label.trim() === 'สถานะ')?.id ?? 'M';

    let totalWeightKg = 0;
    const uniqueVehicles = new Set<string>();
    const uniqueDrivers = new Set<string>();
    let totalRounds = 0;
    let completedCount = 0;
    let inTransitCount = 0;

    filteredRows.forEach((r) => {
      // 1. น้ำหนัก (กก. -> ตัน)
      const rawWeight = r.rawValues[weightColId] ?? r.rawValues['G'];
      if (typeof rawWeight === 'number' && !Number.isNaN(rawWeight)) {
        totalWeightKg += rawWeight;
      } else {
        const strWeight = (r.values[weightColId] ?? r.values['G'] ?? '').replace(
          /,/g,
          ''
        );
        const parsedWeight = parseFloat(strWeight);
        if (!Number.isNaN(parsedWeight)) {
          totalWeightKg += parsedWeight;
        }
      }

      // 2. จำนวนรถที่ย้าย (คัน) และ พนักงานขับรถ
      const rawVeh = (r.values[vehColId] ?? r.values['D'] ?? '').trim();
      if (rawVeh && rawVeh !== '-') {
        uniqueVehicles.add(rawVeh.toUpperCase().replace(/\s+/g, ''));
      }
      const rawDrv = (r.values[driverColId] ?? r.values['C'] ?? '').trim();
      if (rawDrv && rawDrv !== '-') {
        uniqueDrivers.add(rawDrv.replace(/\s+/g, ' '));
      }

      // 3. รอบการย้ายรวม (เที่ยว)
      const rawRound = r.rawValues['V'];
      if (typeof rawRound === 'number' && !Number.isNaN(rawRound) && rawRound > 0) {
        totalRounds += rawRound;
      } else {
        const strRound = (r.values['V'] ?? '').replace(/,/g, '').trim();
        const parsedRound = parseFloat(strRound);
        if (!Number.isNaN(parsedRound) && parsedRound > 0) {
          totalRounds += parsedRound;
        } else {
          totalRounds += 1;
        }
      }

      // 4. สถานะการส่งสินค้า
      const statusText = (
        r.values[statusColId] ??
        r.values['M'] ??
        ''
      ).trim();
      if (
        statusText.includes('เรียบร้อย') ||
        statusText.includes('สำเร็จ')
      ) {
        completedCount += 1;
      } else if (
        statusText.includes('ระหว่าง') ||
        statusText.includes('ระว่าง') ||
        statusText.includes('กำลังส่ง')
      ) {
        inTransitCount += 1;
      }
    });

    const totalWeightTons = totalWeightKg / 1000;
    const completionRate =
      filteredRows.length > 0
        ? Math.round((completedCount / filteredRows.length) * 100)
        : 0;

    return {
      totalWeightTons,
      totalWeightKg,
      vehicleCount: uniqueVehicles.size,
      driverCount: uniqueDrivers.size,
      totalRounds,
      totalRecords: filteredRows.length,
      completedCount,
      inTransitCount,
      completionRate,
    };
  }, [sheetData, filteredRows]);

  // Real-time KPI summary cards specifically for บันทึกงานซ่อม (gid: 944294225)
  const repairKpiMetrics = useMemo(() => {
    let totalRequests = filteredRows.length;
    let pendingApprovalCount = 0;
    let pendingOnlyCount = 0;
    let repliedCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let totalPartsCost = 0;
    let totalLaborCost = 0;

    const sparePartsColId =
      sheetData?.columns.find((c) => c.label.includes('ค่าอะไหล่'))?.id ?? 'N';
    const laborColId =
      sheetData?.columns.find((c) => c.label.includes('ค่าแรง'))?.id ?? 'O';

    filteredRows.forEach((r) => {
      const status = getRowApprovalStatus(r);

      if (
        status === 'รออนุมัติ' ||
        status === 'ตอบกลับข้อมูลเพิ่มเติมแล้ว' ||
        status === 'ขอข้อมูลเพิ่มเติม' ||
        status === 'รอพิจารณา'
      ) {
        pendingApprovalCount += 1;
        if (status === 'ตอบกลับข้อมูลเพิ่มเติมแล้ว') {
          repliedCount += 1;
        } else {
          pendingOnlyCount += 1;
        }
      } else if (status === 'อนุมัติ') {
        approvedCount += 1;
      } else if (status === 'ไม่อนุมัติ') {
        rejectedCount += 1;
      }

      // Calculate spare parts cost
      const partsRaw = r.rawValues[sparePartsColId] ?? r.rawValues['N'];
      if (typeof partsRaw === 'number' && !Number.isNaN(partsRaw)) {
        totalPartsCost += partsRaw;
      } else {
        const parsed = parseFloat(
          String(r.values[sparePartsColId] ?? r.values['N'] ?? '').replace(/,/g, '')
        );
        if (!Number.isNaN(parsed)) totalPartsCost += parsed;
      }

      // Calculate labor cost
      const laborRaw = r.rawValues[laborColId] ?? r.rawValues['O'];
      if (typeof laborRaw === 'number' && !Number.isNaN(laborRaw)) {
        totalLaborCost += laborRaw;
      } else {
        const parsed = parseFloat(
          String(r.values[laborColId] ?? r.values['O'] ?? '').replace(/,/g, '')
        );
        if (!Number.isNaN(parsed)) totalLaborCost += parsed;
      }
    });

    const totalRepairCost = totalPartsCost + totalLaborCost;
    const approvedRate =
      totalRequests > 0 ? Math.round((approvedCount / totalRequests) * 100) : 0;

    return {
      totalRequests,
      pendingApprovalCount,
      pendingOnlyCount,
      repliedCount,
      approvedCount,
      rejectedCount,
      totalPartsCost,
      totalLaborCost,
      totalRepairCost,
      approvedRate,
    };
  }, [sheetData, filteredRows]);

  // Real-time KPI summary cards specifically for บันทึกน้ำมัน (gid: 1733355146)
  const fuelKpiMetrics = useMemo(() => {
    let latestDieselBalance = 0;
    let latestBenzeneBalance = 0;

    let totalInLiters = 0;
    let totalInDiesel = 0;
    let totalInBenzene = 0;

    let totalOutLiters = 0;
    let dispenseCount = 0;

    let totalOutValue = 0;
    let latestPrice = 0;
    let priceSumForAvg = 0;
    let priceCountForAvg = 0;

    const fuelTypeColId =
      sheetData?.columns.find((c) => c.label.includes('ชนิดน้ำมัน'))?.id ?? 'D';
    const inColId =
      sheetData?.columns.find((c) => c.label.includes('รับเข้า'))?.id ?? 'E';
    const priceColId =
      sheetData?.columns.find((c) => c.label.includes('ราคา'))?.id ?? 'F';
    const outColId =
      sheetData?.columns.find((c) => c.label.includes('จ่ายออก'))?.id ?? 'G';
    const amountColId =
      sheetData?.columns.find((c) => c.label.includes('มูลค่า'))?.id ?? 'H';
    const balDieselColId =
      sheetData?.columns.find(
        (c) => c.label.includes('คงเหลือ') && c.label.includes('ดีเซล')
      )?.id ?? 'M';
    const balBenzeneColId =
      sheetData?.columns.find(
        (c) =>
          c.label.includes('คงเหลือ') &&
          (c.label.includes('เบนซิน') || c.label.includes('เบนซิล'))
      )?.id ?? 'N';

    // 1. Find latest balance from top rows
    const rowsForBalance =
      filteredRows.length > 0 ? filteredRows : sheetData?.rows ?? [];
    for (const r of rowsForBalance) {
      const dBalRaw = r.rawValues[balDieselColId] ?? r.rawValues['M'];
      const bBalRaw = r.rawValues[balBenzeneColId] ?? r.rawValues['N'];

      let dParsed =
        typeof dBalRaw === 'number'
          ? dBalRaw
          : parseFloat(
              String(r.values[balDieselColId] ?? r.values['M'] ?? '').replace(
                /,/g,
                ''
              )
            );
      let bParsed =
        typeof bBalRaw === 'number'
          ? bBalRaw
          : parseFloat(
              String(r.values[balBenzeneColId] ?? r.values['N'] ?? '').replace(
                /,/g,
                ''
              )
            );

      if (!latestDieselBalance && !Number.isNaN(dParsed) && dParsed > 0) {
        latestDieselBalance = dParsed;
      }
      if (!latestBenzeneBalance && !Number.isNaN(bParsed) && bParsed > 0) {
        latestBenzeneBalance = bParsed;
      }
      if (latestDieselBalance > 0 && latestBenzeneBalance > 0) break;
    }

    filteredRows.forEach((r) => {
      const fType = (r.values[fuelTypeColId] ?? r.values['D'] ?? '').trim();

      // Liters In
      const inRaw = r.rawValues[inColId] ?? r.rawValues['E'];
      let inVal =
        typeof inRaw === 'number'
          ? inRaw
          : parseFloat(
              String(r.values[inColId] ?? r.values['E'] ?? '').replace(/,/g, '')
            );
      if (!Number.isNaN(inVal) && inVal > 0) {
        totalInLiters += inVal;
        if (fType.includes('ดีเซล')) {
          totalInDiesel += inVal;
        } else if (fType.includes('เบนซิน') || fType.includes('เบนซิล')) {
          totalInBenzene += inVal;
        }
      }

      // Liters Out
      const outRaw = r.rawValues[outColId] ?? r.rawValues['G'];
      let outVal =
        typeof outRaw === 'number'
          ? outRaw
          : parseFloat(
              String(r.values[outColId] ?? r.values['G'] ?? '').replace(/,/g, '')
            );
      if (!Number.isNaN(outVal) && outVal > 0) {
        totalOutLiters += outVal;
        dispenseCount += 1;
      }

      // Value / Amount
      const amountRaw = r.rawValues[amountColId] ?? r.rawValues['H'];
      let amountVal =
        typeof amountRaw === 'number'
          ? amountRaw
          : parseFloat(
              String(r.values[amountColId] ?? r.values['H'] ?? '').replace(/,/g, '')
            );
      if (!Number.isNaN(amountVal) && amountVal > 0) {
        totalOutValue += amountVal;
      }

      // Price
      const priceRaw = r.rawValues[priceColId] ?? r.rawValues['F'];
      let priceVal =
        typeof priceRaw === 'number'
          ? priceRaw
          : parseFloat(
              String(r.values[priceColId] ?? r.values['F'] ?? '').replace(/,/g, '')
            );
      if (!Number.isNaN(priceVal) && priceVal > 0) {
        if (!latestPrice) latestPrice = priceVal;
        priceSumForAvg += priceVal;
        priceCountForAvg += 1;
      }
    });

    const avgPrice =
      priceCountForAvg > 0
        ? priceSumForAvg / priceCountForAvg
        : totalOutLiters > 0
        ? totalOutValue / totalOutLiters
        : 0;

    return {
      latestDieselBalance,
      latestBenzeneBalance,
      totalInLiters,
      totalInDiesel,
      totalInBenzene,
      totalOutLiters,
      dispenseCount,
      totalOutValue,
      latestPrice,
      avgPrice,
    };
  }, [sheetData, filteredRows]);

  const handleSort = (colId: string) => {
    setSortConfig((prev) => {
      if (!prev || prev.colId !== colId) {
        return { colId, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { colId, direction: 'desc' };
      }
      return null;
    });
  };

  const handleTriggerDeepSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    setDeepSearchTerm(trimmed);
    loadData({ silent: false, remoteSearch: trimmed });
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSelectedColumnId('ALL');
    setQuickFilterValue('ALL');
    setStartDateFilter('');
    setEndDateFilter('');
    if (deepSearchTerm !== '') {
      setDeepSearchTerm('');
    }
  };

  const handleExportCsv = () => {
    if (!sheetData || sortedRows.length === 0) return;
    const headers = ['ลำดับแถว', ...sheetData.columns.map((c) => c.label)];
    const csvLines = [
      headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
      ...sortedRows.map((row) => {
        const cells = [
          String(row.rowNumber),
          ...sheetData.columns.map((col) => row.values[col.id] ?? ''),
        ];
        return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
      }),
    ];
    const csvContent = '\uFEFF' + csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sheetData.tabName}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Highlight matching search text inside cell
  const renderHighlightedText = (text: string) => {
    if (!text) return <span className="text-slate-300">-</span>;
    const q = searchQuery.trim();
    if (!q) return text;

    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const matchIdx = lowerText.indexOf(lowerQ);
    if (matchIdx === -1) return text;

    const before = text.slice(0, matchIdx);
    const match = text.slice(matchIdx, matchIdx + q.length);
    const after = text.slice(matchIdx + q.length);

    return (
      <>
        {before}
        <mark className="rounded-xs bg-amber-200/80 px-0.5 text-slate-900">
          {match}
        </mark>
        {after}
      </>
    );
  };

  const formattedFetchTime = useMemo(() => {
    if (!sheetData?.fetchedAt) return '-';
    return new Date(sheetData.fetchedAt).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, [sheetData?.fetchedAt]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-68 shrink-0 flex-col border-r border-slate-200/90 bg-slate-50/70 backdrop-blur-xs transition-transform duration-200 lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200/90 bg-white px-4 py-3.5">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              handleSelectTab(SHEET_TABS[0]);
            }}
            className="flex items-center gap-2.5 min-w-0"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-amber-400 shadow-xs">
              <Truck className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-slate-900 truncate">
                ระบบขนส่งและงานซ่อมบำรุง
              </div>
              <div className="text-[11px] font-medium text-slate-500 truncate">
                เมนูหลักจัดการฐานข้อมูล
              </div>
            </div>
          </a>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="ปิดเมนู"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3.5">
          <div className="px-2 pb-2 text-[11px] font-semibold tracking-wide text-slate-400">
            เมนูหลัก (ตารางข้อมูล)
          </div>
          <nav className="space-y-2">
            {SHEET_TABS.map((tab) => {
              const isSelected = activeTab.gid === tab.gid;
              const isRepairTab = tab.gid === '944294225';
              const isFuelTab = tab.gid === '1733355146';

              const renderTabIcon = () => {
                const iconClass = 'h-4 w-4 shrink-0';
                switch (tab.gid) {
                  case '606634465':
                    return <Repeat className={iconClass} />;
                  case '944294225':
                    return <Wrench className={iconClass} />;
                  case '378250263':
                    return <Truck className={iconClass} />;
                  case '1733355146':
                    return <Fuel className={iconClass} />;
                  case '1031154414':
                    return <SlidersHorizontal className={iconClass} />;
                  case '1032541508':
                    return <Calendar className={iconClass} />;
                  case '1156877149':
                    return <Home className={iconClass} />;
                  case '1295975917':
                    return <Scale className={iconClass} />;
                  default:
                    return <Truck className={iconClass} />;
                }
              };

              return (
                <div key={tab.gid} className="space-y-1">
                  {/* เมนูหลัก: เด่นชัด มีกรอบไอคอนและตัวอักษรหนา */}
                  <button
                    type="button"
                    onClick={() => handleSelectTab(tab)}
                    className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
                      isSelected
                        ? 'bg-slate-900 text-white shadow-sm ring-1 ring-slate-900'
                        : 'bg-white text-slate-800 border border-slate-200/80 shadow-2xs hover:border-slate-300 hover:bg-slate-100/70 hover:text-slate-950'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          isSelected
                            ? 'bg-white/15 text-amber-300'
                            : 'bg-slate-100 text-slate-700 group-hover:bg-slate-200/80 group-hover:text-slate-900'
                        }`}
                      >
                        {renderTabIcon()}
                      </span>
                      <div className="min-w-0">
                        <div
                          className={`truncate text-sm font-bold leading-snug ${
                            isSelected ? 'text-white' : 'text-slate-900'
                          }`}
                        >
                          {tab.name}
                        </div>
                        <div
                          className={`truncate text-[11px] leading-tight ${
                            isSelected ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {tab.category}
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      className={`ml-1.5 h-4 w-4 shrink-0 transition-transform ${
                        isSelected
                          ? 'text-amber-300 translate-x-0.5'
                          : 'text-slate-300 group-hover:text-slate-500'
                      }`}
                    />
                  </button>

                  {/* เมนูย่อยของ บันทึกงานซ่อม (ขนาดกะทัดรัด เยื้องเข้าด้านใน ไม่แย่งความเด่นเมนูหลัก) */}
                  {isRepairTab && (
                    <div className="ml-6 pl-3 border-l border-slate-200 space-y-0.5 py-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSidebarOpen(false);
                          if (activeTab.gid !== '944294225') {
                            handleSelectTab(tab);
                          }
                          setIsRepairModalOpen(true);
                        }}
                        className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                      >
                        <Plus className="h-3.5 w-3.5 text-amber-600 shrink-0 transition-transform group-hover:scale-110" />
                        <span className="truncate">บันทึกแจ้งซ่อม</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsSidebarOpen(false);
                          setIsApprovalModalOpen(true);
                        }}
                        className="group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span className="truncate">ผู้จัดการอนุมัติงานซ่อม</span>
                        </div>
                        {pendingApprovalCount > 0 && (
                          <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-600 px-1.5 py-0.2 font-mono text-[10px] font-bold text-white shadow-2xs shrink-0 tabular-nums">
                            {pendingApprovalCount.toLocaleString('th-TH')}
                          </span>
                        )}
                      </button>
                    </div>
                  )}

                  {/* เมนูย่อยของ บันทึกน้ำมัน (ขนาดกะทัดรัด เยื้องเข้าด้านใน) */}
                  {isFuelTab && (
                    <div className="ml-6 pl-3 border-l border-slate-200 space-y-0.5 py-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSidebarOpen(false);
                          if (activeTab.gid !== '1733355146') {
                            handleSelectTab(tab);
                          }
                          setIsFuelModalOpen(true);
                        }}
                        className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                      >
                        <Plus className="h-3.5 w-3.5 text-sky-600 shrink-0 transition-transform group-hover:scale-110" />
                        <span className="truncate">บันทึกน้ำมัน (รับเข้า-เบิกออก)</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="border-t border-slate-200/90 bg-white px-4 py-2.5 flex items-center justify-between text-xs">
          <span className="text-[11px] font-medium text-slate-500">เวอร์ชันระบบ</span>
          <span className="font-mono font-semibold text-slate-700 text-[11px] tabular-nums">
            v{APP_VERSION}
          </span>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact Sticky Top Bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-6 sm:py-2.5 lg:px-8">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="เปิดเมนู"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 lg:hidden shrink-0"
            >
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="text-sm font-bold text-slate-900 sm:text-base truncate">
              {activeTab.name}
            </h1>
            <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] sm:text-[11px] font-mono font-medium text-slate-600 border border-slate-200 shrink-0">
              v{APP_VERSION}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {activeTab.gid === '606634465' && (
              <button
                type="button"
                onClick={() => setIsJobModalOpen(true)}
                className="hidden md:inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>บันทึกย้ายงาน</span>
              </button>
            )}

            {activeTab.gid === '1156877149' && (
              <button
                type="button"
                onClick={() => setIsDeliveryPointModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>เพิ่มจุดส่งสินค้า</span>
              </button>
            )}

            {activeTab.gid === '1733355146' && (
              <button
                type="button"
                onClick={() => setIsFuelModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>บันทึกน้ำมัน (รับเข้า-เบิกออก)</span>
              </button>
            )}

            {activeTab.gid === '944294225' && (
              <>
                <button
                  type="button"
                  onClick={() => setIsRepairModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>แจ้งซ่อม</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 whitespace-nowrap shrink-0"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>ผู้อนุมัติ</span>
                  {pendingApprovalCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-600 px-1.5 py-0.2 font-mono text-[10px] font-bold text-white animate-pulse">
                      {pendingApprovalCount.toLocaleString('th-TH')}
                    </span>
                  )}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleToggleMobileNotifications}
              title={
                notificationPermission === 'granted'
                  ? 'ระบบแจ้งเตือนบนมือถือเปิดใช้งานแล้ว'
                  : 'คลิกเพื่อเปิดการแจ้งเตือนเด้งบนมือถือเมื่อมีแจ้งซ่อมใหม่'
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors shrink-0 ${
                notificationPermission === 'granted'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 animate-pulse'
              }`}
            >
              <Bell className="h-3.5 w-3.5 text-amber-600" />
              <span className="hidden sm:inline">
                {notificationPermission === 'granted'
                  ? 'การแจ้งเตือนเปิดแล้ว'
                  : 'เปิดแจ้งเตือนมือถือ'}
              </span>
            </button>

            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setIsWebhookModalOpen(true)}
              title="ตั้งค่าเชื่อมต่อชีต (ไม่ต้องล็อกอิน)"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">เชื่อมต่อชีต</span>
            </button>

            <button
              type="button"
              onClick={() => loadData({ silent: true })}
              disabled={isLoading || isRefreshing}
              title="ซิงค์ข้อมูลล่าสุด"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isLoading || isRefreshing ? 'animate-spin' : ''
                }`}
              />
              <span className="hidden sm:inline">ซิงค์ข้อมูล</span>
            </button>
          </div>
        </header>

        <main className="w-full px-2.5 pt-2.5 pb-24 sm:px-6 sm:pt-4 sm:pb-24 lg:px-8 lg:pb-6">
          {/* Floating Toast Notification when a new repair request pops up */}
          {newRepairToast && (
            <div className="fixed bottom-5 right-4 z-[100] max-w-xs sm:max-w-sm rounded-xl border border-amber-300 bg-slate-900/95 p-3.5 sm:p-4 font-sans text-white shadow-2xl backdrop-blur-md">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-amber-400 shrink-0" />
                  <span className="font-bold text-xs sm:text-sm text-amber-300">
                    🔔 มีรายการแจ้งซ่อมใหม่!
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setNewRepairToast(null)}
                  className="rounded p-1 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 text-xs text-slate-200 space-y-0.5">
                <div>
                  <span className="font-semibold text-amber-200">รถ/อุปกรณ์:</span>{' '}
                  {newRepairToast.vehicle}
                </div>
                <div className="truncate">
                  <span className="font-semibold text-amber-200">อาการ:</span>{' '}
                  {newRepairToast.symptom}
                </div>
                {newRepairToast.reporter && (
                  <div className="text-slate-400">
                    ผู้แจ้ง: {newRepairToast.reporter}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setNewRepairToast(null);
                  const repairTab = SHEET_TABS.find((t) => t.gid === '944294225');
                  if (repairTab) handleSelectTab(repairTab);
                }}
                className="mt-3 w-full rounded-lg bg-amber-500 py-1.5 text-center text-xs font-bold text-slate-950 hover:bg-amber-400 shadow-xs"
              >
                ดูรายการแจ้งซ่อม
              </button>
            </div>
          )}

          {/* Save Success Notification */}
          {saveSuccessMsg && (
            <div className="mb-2.5 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs sm:text-sm text-emerald-900">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="font-medium truncate">{saveSuccessMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setSaveSuccessMsg(null)}
                className="ml-2 text-xs font-medium text-emerald-800 hover:underline shrink-0"
              >
                ปิด
              </button>
            </div>
          )}

          {/* Mobile-Only Direct Job Transfer Form (when on הבันทึกการย้ายงาน tab) */}
          {activeTab.gid === '606634465' && (
            <div className="md:hidden">
              <JobTransferModal
                isOpen={true}
                inlineMode={true}
                onClose={() => {}}
                existingRows={sheetData?.rows ?? []}
                onSavedSuccess={() => {
                  setSaveSuccessMsg('บันทึกข้อมูลการย้ายงานเรียบร้อยแล้ว');
                  loadData({ silent: true });
                  setTimeout(() => {
                    setSaveSuccessMsg(null);
                  }, 5000);
                }}
              />
            </div>
          )}

          {/* Dashboard KPI, Search & Table (Hidden on mobile when on บันทึกการย้ายงาน so mobile shows ONLY the form) */}
          <div className={activeTab.gid === '606634465' ? 'hidden md:block' : 'block'}>
          {/* Glassmorphism 4-Card KPI Summary Strip (Unified across all tabs) */}
          {activeTab.gid === '606634465' ? (
            <div className="relative rounded-2xl bg-gradient-to-br from-sky-100/60 via-slate-100/70 to-emerald-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: น้ำหนักที่ย้าย (ตัน) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-sky-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        1. น้ำหนักที่ย้าย (ตัน)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : jobTransferKpiMetrics.totalWeightTons.toLocaleString(
                                'th-TH',
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }
                              )}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-sky-700">
                          ตัน
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200/70 bg-sky-500/10 text-sky-700 backdrop-blur-sm">
                      <Scale className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    รวม{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {jobTransferKpiMetrics.totalWeightKg.toLocaleString('th-TH', {
                        maximumFractionDigits: 0,
                      })}
                    </span>{' '}
                    กก.
                  </div>
                </div>

                {/* Card 2: จำนวนรถที่ย้าย (คัน) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        2. จำนวนรถที่ย้าย (คัน)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : jobTransferKpiMetrics.vehicleCount.toLocaleString(
                                'th-TH'
                              )}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-indigo-700">
                          คัน
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-500/10 text-indigo-700 backdrop-blur-sm">
                      <Truck className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    พนักงานขับรถปฏิบัติงาน{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {jobTransferKpiMetrics.driverCount.toLocaleString('th-TH')}
                    </span>{' '}
                    คน
                  </div>
                </div>

                {/* Card 3: รอบการย้ายรวม (เที่ยว) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        3. รอบการย้ายรวม (เที่ยว)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : jobTransferKpiMetrics.totalRounds.toLocaleString(
                                'th-TH'
                              )}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-amber-700">
                          เที่ยว
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700 backdrop-blur-sm">
                      <Repeat className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    จากรายการบันทึก{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {jobTransferKpiMetrics.totalRecords.toLocaleString('th-TH')}
                    </span>{' '}
                    รายการ
                  </div>
                </div>

                {/* Card 4: ส่งสินค้าสำเร็จ (รายการ) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        4. ส่งสินค้าสำเร็จ (รายการ)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : jobTransferKpiMetrics.completedCount.toLocaleString(
                                'th-TH'
                              )}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    กำลังส่ง{' '}
                    <span className="font-sans font-bold tracking-tight text-amber-700 tabular-nums">
                      {jobTransferKpiMetrics.inTransitCount.toLocaleString('th-TH')}
                    </span>{' '}
                    รายการ · สำเร็จ{' '}
                    <span className="font-sans font-bold tracking-tight text-emerald-700 tabular-nums">
                      {jobTransferKpiMetrics.completionRate}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab.gid === '944294225' ? (
            <div className="relative rounded-2xl bg-gradient-to-br from-indigo-100/60 via-slate-100/70 to-emerald-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: แจ้งซ่อมทั้งหมด */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        แจ้งซ่อมทั้งหมด
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : repairKpiMetrics.totalRequests.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-indigo-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-500/10 text-indigo-700 backdrop-blur-sm">
                      <Wrench className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    กำลังแสดงผล{' '}
                    <span className="font-sans font-bold tracking-tight text-indigo-700 tabular-nums">
                      {repairKpiMetrics.totalRequests.toLocaleString('th-TH')}
                    </span>{' '}
                    จากทั้งหมด{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {(sheetData?.totalRowsInSheet ?? repairKpiMetrics.totalRequests).toLocaleString('th-TH')}
                    </span>{' '}
                    รายการ
                  </div>
                </div>

                {/* Card 2: รออนุมัติ */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        รออนุมัติ
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : repairKpiMetrics.pendingApprovalCount.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-amber-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700 backdrop-blur-sm">
                      <Clock className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    รออนุมัติ{' '}
                    <span className="font-sans font-bold tracking-tight text-amber-700 tabular-nums">
                      {repairKpiMetrics.pendingOnlyCount.toLocaleString('th-TH')}
                    </span>{' '}
                    · ตอบกลับแล้ว{' '}
                    <span className="font-sans font-bold tracking-tight text-indigo-700 tabular-nums">
                      {repairKpiMetrics.repliedCount.toLocaleString('th-TH')}
                    </span>
                  </div>
                </div>

                {/* Card 3: อนุมัติแล้ว / ไม่อนุมัติ */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        อนุมัติแล้ว / ไม่อนุมัติ
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <div className="flex items-baseline gap-1 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                          <span>
                            {isLoading && !sheetData
                              ? '...'
                              : repairKpiMetrics.approvedCount.toLocaleString('th-TH')}
                          </span>
                          <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
                            อนุมัติ
                          </span>
                        </div>
                        <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 font-sans text-xs font-bold tracking-tight text-rose-700 border border-rose-200/70 backdrop-blur-sm tabular-nums">
                          ไม่อนุมัติ {repairKpiMetrics.rejectedCount.toLocaleString('th-TH')}
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    อนุมัติแล้วคิดเป็น{' '}
                    <span className="font-sans font-bold tracking-tight text-emerald-700 tabular-nums">
                      {repairKpiMetrics.approvedRate}%
                    </span>{' '}
                    ของรายการที่แสดง
                  </div>
                </div>

                {/* Card 4: ยอดรวมค่าซ่อมสุทธิ (บาท) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-violet-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        ยอดรวมค่าซ่อมสุทธิ (บาท)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : `${repairKpiMetrics.totalRepairCost.toLocaleString('th-TH', {
                                maximumFractionDigits: 0,
                              })} ฿`}
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200/70 bg-violet-500/10 text-violet-700 backdrop-blur-sm">
                      <Coins className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    อะไหล่{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {repairKpiMetrics.totalPartsCost.toLocaleString('th-TH', {
                        maximumFractionDigits: 0,
                      })} ฿
                    </span>{' '}
                    · ค่าแรง{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {repairKpiMetrics.totalLaborCost.toLocaleString('th-TH', {
                        maximumFractionDigits: 0,
                      })} ฿
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab.gid === '1733355146' ? (
            <div className="relative rounded-2xl bg-gradient-to-br from-sky-100/60 via-slate-100/70 to-emerald-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: คงเหลือน้ำมันปัจจุบัน (ลิตร) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-blue-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        คงเหลือน้ำมันปัจจุบัน (ลิตร)
                      </div>
                      <div className="mt-2 flex flex-col gap-1 sm:gap-1.5">
                        <div className="flex items-baseline justify-between gap-2 font-sans text-xs sm:text-sm font-semibold text-slate-800 tabular-nums">
                          <span className="text-slate-500 text-[11px] font-sans">ดีเซล:</span>
                          <span className="font-sans text-sm sm:text-base font-extrabold tracking-tight text-blue-700 tabular-nums">
                            {isLoading && !sheetData
                              ? '...'
                              : `${fuelKpiMetrics.latestDieselBalance.toLocaleString('th-TH')} ลิตร`}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 font-sans text-xs sm:text-sm font-semibold text-slate-800 tabular-nums">
                          <span className="text-slate-500 text-[11px] font-sans">เบนซิน:</span>
                          <span className="font-sans text-sm sm:text-base font-extrabold tracking-tight text-indigo-700 tabular-nums">
                            {isLoading && !sheetData
                              ? '...'
                              : `${fuelKpiMetrics.latestBenzeneBalance.toLocaleString('th-TH')} ลิตร`}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/70 bg-blue-500/10 text-blue-700 backdrop-blur-sm">
                      <Fuel className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    ยอดคงเหลือล่าสุดจากฐานข้อมูล
                  </div>
                </div>

                {/* Card 2: ยอดรับเข้าสะสม (ลิตร) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        ยอดรับเข้าสะสม (ลิตร)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : fuelKpiMetrics.totalInLiters.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
                          ลิตร
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <Droplet className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    ดีเซล{' '}
                    <span className="font-sans font-bold tracking-tight text-emerald-700 tabular-nums">
                      {fuelKpiMetrics.totalInDiesel.toLocaleString('th-TH')}
                    </span>{' '}
                    ลิตร · เบนซิน{' '}
                    <span className="font-sans font-bold tracking-tight text-indigo-700 tabular-nums">
                      {fuelKpiMetrics.totalInBenzene.toLocaleString('th-TH')}
                    </span>{' '}
                    ลิตร
                  </div>
                </div>

                {/* Card 3: ยอดจ่ายออกสะสม (ลิตร) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        ยอดจ่ายออกสะสม (ลิตร)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : fuelKpiMetrics.totalOutLiters.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-amber-700">
                          ลิตร
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700 backdrop-blur-sm">
                      <Repeat className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    เบิกจ่ายทั้งหมด{' '}
                    <span className="font-sans font-bold tracking-tight text-amber-700 tabular-nums">
                      {fuelKpiMetrics.dispenseCount.toLocaleString('th-TH')}
                    </span>{' '}
                    ครั้ง
                  </div>
                </div>

                {/* Card 4: มูลค่าจ่ายออกรวม (บาท) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-violet-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        มูลค่าจ่ายออกรวม (บาท)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : `${fuelKpiMetrics.totalOutValue.toLocaleString('th-TH', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })} ฿`}
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200/70 bg-violet-500/10 text-violet-700 backdrop-blur-sm">
                      <Coins className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    ราคาล่าสุด{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {fuelKpiMetrics.latestPrice.toLocaleString('th-TH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>{' '}
                    ฿/ลิตร · เฉลี่ย{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {fuelKpiMetrics.avgPrice.toLocaleString('th-TH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>{' '}
                    ฿/ลิตร
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative rounded-2xl bg-gradient-to-br from-sky-100/60 via-slate-100/70 to-emerald-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: ทั้งหมดในชีต */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-sky-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        ทั้งหมดในชีต
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : (sheetData?.totalRowsInSheet ?? 0).toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-sky-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200/70 bg-sky-500/10 text-sky-700 backdrop-blur-sm">
                      <SlidersHorizontal className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    ฐานข้อมูล {activeTab.name}
                  </div>
                </div>

                {/* Card 2: แสดงผล */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        แสดงผล
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : sortedRows.length.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-indigo-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-500/10 text-indigo-700 backdrop-blur-sm">
                      <Eye className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    รายการที่กรองแสดงผลปัจจุบัน
                  </div>
                </div>

                {/* Card 3: Contextual Metric */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        {contextualMetric.label}
                      </div>
                      <div className="mt-1.5 truncate font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        {isLoading && !sheetData ? '...' : contextualMetric.value}
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    {contextualMetric.subtext}
                  </div>
                </div>

                {/* Card 4: อัปเดตล่าสุด */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        อัปเดตล่าสุด
                      </div>
                      <div className="mt-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        {formattedFetchTime}
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700 backdrop-blur-sm">
                      <Clock className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    ซิงค์ข้อมูลจาก Google Sheets
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">เกิดข้อผิดพลาด</div>
                  <div className="break-words text-red-700">{error}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadData({ silent: false })}
                className="rounded-lg bg-red-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-800 whitespace-nowrap shrink-0"
              >
                ลองใหม่
              </button>
            </div>
          )}

          {/* Main Data Table Card */}
          <div className="mt-2.5 sm:mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    {activeTab.gid !== '944294225' && (
                      <th
                        className={`w-16 px-2.5 py-2 sm:px-4 sm:py-2.5 whitespace-nowrap ${
                          activeTab.gid === '1733355146' ? 'hidden sm:table-cell' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort('__ROW__')}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          <span>แถว</span>
                          {sortConfig?.colId === '__ROW__' ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="h-3 w-3 text-slate-900" />
                            ) : (
                              <ArrowDown className="h-3 w-3 text-slate-900" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 text-slate-400" />
                          )}
                        </button>
                      </th>
                    )}
                    {sheetData?.columns.map((col) => {
                      const isSorted = sortConfig?.colId === col.id;
                      const isNumeric = col.type === 'number';
                      const isFuelTab = activeTab.gid === '1733355146';
                      const isFuelMainCol =
                        isFuelTab &&
                        (col.id === 'D' ||
                          col.id === 'E' ||
                          col.id === 'F' ||
                          col.id === 'G' ||
                          col.id === 'H' ||
                          col.label.includes('ชนิดน้ำมัน') ||
                          col.label.includes('รับเข้า') ||
                          col.label.includes('ราคา') ||
                          col.label.includes('จ่ายออก') ||
                          col.label.includes('มูลค่า'));
                      const isHiddenOnMobile = isFuelTab && !isFuelMainCol;

                      return (
                        <th
                          key={col.id}
                          className={`px-2.5 py-2 sm:px-4 sm:py-2.5 whitespace-nowrap ${
                            isHiddenOnMobile ? 'hidden sm:table-cell' : ''
                          } ${isNumeric ? 'text-right' : 'text-left'}`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSort(col.id)}
                            className={`inline-flex items-center gap-1 hover:text-slate-900 ${
                              isNumeric ? 'ml-auto flex-row-reverse' : ''
                            }`}
                          >
                            <span>
                              {activeTab.gid === '944294225' && col.id === 'Q'
                                ? 'รูปถ่าย'
                                : col.label}
                            </span>
                            {isSorted ? (
                              sortConfig.direction === 'asc' ? (
                                <ArrowUp className="h-3 w-3 text-slate-900 shrink-0" />
                              ) : (
                                <ArrowDown className="h-3 w-3 text-slate-900 shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-slate-400 shrink-0" />
                            )}
                          </button>
                        </th>
                      );
                    })}
                    {activeTab.gid === '944294225' && (
                      <th className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap">
                        จัดการ
                      </th>
                    )}
                    {activeTab.gid === '378250263' && (
                      <th className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap">
                        เพิ่มเติม
                      </th>
                    )}
                  </tr>
                </thead>

              <tbody className="divide-y divide-slate-100 text-sm">
                {isLoading && !sheetData ? (
                  Array.from({ length: 10 }).map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      {activeTab.gid !== '944294225' && (
                        <td className="px-4 py-3">
                          <div className="h-4 w-12 rounded bg-slate-200" />
                        </td>
                      )}
                      {Array.from({ length: 6 }).map((__, cIdx) => (
                        <td key={cIdx} className="px-4 py-3">
                          <div className="h-4 w-28 rounded bg-slate-200" />
                        </td>
                      ))}
                      {(activeTab.gid === '944294225' || activeTab.gid === '378250263') && (
                        <td className="px-4 py-3 text-center">
                          <div className="mx-auto h-4 w-20 rounded bg-slate-200" />
                        </td>
                      )}
                    </tr>
                  ))
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={(sheetData?.columns.length ?? 5) + (activeTab.gid === '944294225' ? 1 : 2)}
                      className="px-6 py-14 text-center"
                    >
                      <div className="mx-auto max-w-md">
                        <div className="text-base font-semibold text-slate-900">
                          {sheetData && sheetData.rows.length === 0
                            ? 'ไม่มีรายการข้อมูล'
                            : 'ไม่พบข้อมูล'}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {sheetData && sheetData.rows.length === 0
                            ? 'ไม่พบข้อมูลในตารางนี้จาก Google Sheets'
                            : searchQuery
                            ? `ไม่พบข้อมูลที่มีคำว่า "${searchQuery}" ในชุดข้อมูลที่เลือก`
                            : startDateFilter || endDateFilter
                            ? 'ไม่พบข้อมูลในช่วงวันที่ระบุ'
                            : 'ไม่พบรายการข้อมูลที่ตรงกับเงื่อนไขการค้นหา'}
                        </p>
                        <div className="mt-4 flex items-center justify-center gap-2">
                          {(searchQuery !== '' ||
                            selectedColumnId !== 'ALL' ||
                            quickFilterValue !== 'ALL' ||
                            deepSearchTerm !== '') && (
                            <button
                              type="button"
                              onClick={handleClearSearch}
                              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                            >
                              ล้างคำค้นหาทั้งหมด
                            </button>
                          )}
                          {searchQuery.trim() !== '' &&
                            sheetData &&
                            sheetData.totalRowsInSheet > rowLimit &&
                            deepSearchTerm !== searchQuery.trim() && (
                              <button
                                type="button"
                                onClick={handleTriggerDeepSearch}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                              >
                                ค้นหาลึกทั้งชีต ({sheetData.totalRowsInSheet.toLocaleString('th-TH')} แถว)
                              </button>
                            )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (activeTab.gid === '944294225' ||
                    activeTab.gid === '606634465' ||
                    activeTab.gid === '378250263') &&
                  repairGroupedRows ? (
                  Array.from(repairGroupedRows.entries()).map(([status, rows]) => {
                    const isCollapsed = collapsedGroups[status] ?? true;
                    const colSpan =
                      (sheetData?.columns.length ?? 5) +
                      (activeTab.gid === '378250263' ? 2 : 1);
                    const groupPageSize = activeTab.gid === '378250263' ? 50 : 15;
                    const currentGroupPage = groupPages[status] ?? 1;
                    const groupTotalPages = Math.max(1, Math.ceil(rows.length / groupPageSize));
                    const paginatedGroupRows = rows.slice(
                      (currentGroupPage - 1) * groupPageSize,
                      currentGroupPage * groupPageSize
                    );
                    const groupTheme = getGroupHeaderTheme(status, activeTab.gid);
                    return (
                      <React.Fragment key={status}>
                        <tr
                          onClick={() =>
                            setCollapsedGroups((prev) => ({
                              ...prev,
                              [status]: !isCollapsed,
                            }))
                          }
                          className={`cursor-pointer font-semibold transition-all duration-150 select-none ${groupTheme.rowClassName}`}
                        >
                          <td colSpan={colSpan} className="relative px-3 py-2.5 sm:px-4 sm:py-3">
                            <div
                              className={`absolute inset-y-0 left-0 w-1.5 ${groupTheme.accentBarClassName}`}
                            />
                            <div className="flex items-center gap-3 pl-1.5">
                              <div className="flex items-center gap-2.5">
                                <button
                                  type="button"
                                  aria-label={isCollapsed ? `ขยาย ${status}` : `ย่อ ${status}`}
                                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${groupTheme.chevronBtnClassName}`}
                                >
                                  {isCollapsed ? (
                                    <ChevronRight className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </button>
                                <span
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${groupTheme.iconBadgeClassName}`}
                                >
                                  {groupTheme.iconType === 'in_transit' ? (
                                    <Truck className="h-3.5 w-3.5" />
                                  ) : groupTheme.iconType === 'completed' ? (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  ) : groupTheme.iconType === 'rejected' ? (
                                    <X className="h-3.5 w-3.5" />
                                  ) : groupTheme.iconType === 'pending' ? (
                                    <Clock className="h-3.5 w-3.5" />
                                  ) : groupTheme.iconType === 'shift' ? (
                                    <Truck className="h-3.5 w-3.5" />
                                  ) : (
                                    <AlertCircle className="h-3.5 w-3.5" />
                                  )}
                                </span>
                                <span className={`text-xs sm:text-sm ${groupTheme.titleClassName}`}>
                                  {status}
                                </span>
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-mono tabular-nums ${groupTheme.countBadgeClassName}`}
                                >
                                  {rows.length.toLocaleString('th-TH')} รายการ
                                </span>
                              </div>
                              <span
                                className={`rounded-md px-2 py-0.5 text-[11px] ${groupTheme.actionHintClassName}`}
                              >
                                {isCollapsed ? 'คลิกเพื่อขยาย' : 'คลิกเพื่อย่อ'}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {!isCollapsed && (
                          <>
                            {paginatedGroupRows.map((row) => (
                              <tr
                                key={row.rowNumber}
                                onClick={() => setSelectedRow(row)}
                                className="cursor-pointer transition-colors hover:bg-slate-50"
                              >
                                {activeTab.gid !== '944294225' && (
                                  <td className="px-2.5 py-2 sm:px-4 sm:py-2.5 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                                    <span>#{row.rowNumber.toLocaleString('th-TH')}</span>
                                  </td>
                                )}
                                {sheetData?.columns.map((col) => {
                                  const val = row.values[col.id] ?? '';
                                  const isNumeric = col.type === 'number';
                                  const isMono =
                                    isNumeric ||
                                    col.type === 'date' ||
                                    col.type === 'datetime' ||
                                    col.type === 'timeofday';

                                  const isEditableGateCell =
                                    activeTab.gid === '1156877149' && col.id === 'C';
                                  const isEditableVehicleRegCell = false;
                                  const isEditableJobNoteCell =
                                    activeTab.gid === '606634465' && col.id === 'N';
                                  const isEditableInlineCell =
                                    isEditableGateCell ||
                                    isEditableVehicleRegCell ||
                                    isEditableJobNoteCell;
                                  const isEditingThisRow =
                                    isEditableInlineCell &&
                                    editingGateRowNumber === row.rowNumber &&
                                    editingColumnId === col.id;
                                  const isConfirmingThisRow =
                                    isEditableInlineCell &&
                                    confirmingGateRowNumber === row.rowNumber &&
                                    editingColumnId === col.id;
                                  const isOver20MinDuration =
                                    activeTab.gid === '606634465' &&
                                    (col.id === 'L' || col.label === 'เวลาที่ใช้') &&
                                    isDurationExceeding20Minutes(val);

                                  return (
                                    <td
                                      key={col.id}
                                      onClick={
                                        isEditableInlineCell
                                          ? (e) => {
                                              e.stopPropagation();
                                              if (!isEditingThisRow && !isConfirmingThisRow) {
                                                setEditingGateRowNumber(row.rowNumber);
                                                setEditingColumnId(col.id);
                                                setEditingGateValue(val);
                                                setConfirmingGateRowNumber(null);
                                              }
                                            }
                                          : undefined
                                      }
                                      className={`px-2.5 py-2 sm:px-4 sm:py-2.5 ${
                                        isOver20MinDuration
                                          ? 'bg-red-50 font-bold text-red-600'
                                          : 'text-slate-800'
                                      } ${
                                        isEditableInlineCell
                                          ? 'min-w-[220px] sm:min-w-[280px] cursor-pointer'
                                          : 'max-w-[220px] sm:max-w-[260px] truncate'
                                      } ${isNumeric ? 'text-right' : 'text-left'} ${
                                        isMono ? 'font-mono text-xs tabular-nums' : 'text-xs sm:text-sm'
                                      }`}
                                      title={
                                        isEditableInlineCell
                                          ? 'คลิกเพื่อแก้ไขข้อมูลเพิ่มเติม'
                                          : val
                                      }
                                    >
                                      {isEditableInlineCell ? (
                                        isConfirmingThisRow ? (
                                          <div
                                            className="flex flex-wrap items-center gap-1.5"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <span className="text-xs text-slate-700">
                                              ยืนยัน{' '}
                                              <strong className="font-semibold text-slate-900">
                                                {editingGateValue.trim() || '(ว่าง)'}
                                              </strong>
                                              ?
                                            </span>
                                            <button
                                              type="button"
                                              disabled={isUpdatingGate}
                                              onClick={() => handleConfirmGateUpdate(row)}
                                              className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                                            >
                                              <Check className="h-3 w-3" />
                                              <span>
                                                {isUpdatingGate ? 'กำลังบันทึก...' : 'ยืนยัน'}
                                              </span>
                                            </button>
                                            <button
                                              type="button"
                                              disabled={isUpdatingGate}
                                              onClick={() => {
                                                setConfirmingGateRowNumber(null);
                                              }}
                                              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                                            >
                                              ย้อนกลับ
                                            </button>
                                          </div>
                                        ) : isEditingThisRow ? (
                                          <div
                                            className="flex items-center gap-1.5"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <input
                                              type="text"
                                              autoFocus
                                              value={editingGateValue}
                                              onChange={(e) => setEditingGateValue(e.target.value)}
                                              placeholder={
                                                isEditableJobNoteCell
                                                  ? 'พิมพ์หมายเหตุ...'
                                                  : undefined
                                              }
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  if (
                                                    (isEditableJobNoteCell ||
                                                      editingGateValue.trim()) &&
                                                    editingGateValue.trim() !== val.trim()
                                                  ) {
                                                    setConfirmingGateRowNumber(row.rowNumber);
                                                  } else {
                                                    setEditingGateRowNumber(null);
                                                    setEditingColumnId(null);
                                                  }
                                                } else if (e.key === 'Escape') {
                                                  setEditingGateRowNumber(null);
                                                  setEditingColumnId(null);
                                                  setConfirmingGateRowNumber(null);
                                                }
                                              }}
                                              className="w-40 sm:w-52 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (
                                                  (isEditableJobNoteCell ||
                                                    editingGateValue.trim()) &&
                                                  editingGateValue.trim() !== val.trim()
                                                ) {
                                                  setConfirmingGateRowNumber(row.rowNumber);
                                                } else {
                                                  setEditingGateRowNumber(null);
                                                  setEditingColumnId(null);
                                                }
                                              }}
                                              className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                                            >
                                              บันทึก
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setEditingGateRowNumber(null);
                                                setEditingColumnId(null);
                                                setConfirmingGateRowNumber(null);
                                              }}
                                              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                                            >
                                              ยกเลิก
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center justify-between gap-1.5 group/cell hover:text-slate-900">
                                            <span className="truncate">{renderHighlightedText(val || '-')}</span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingGateRowNumber(row.rowNumber);
                                                setEditingColumnId(col.id);
                                                setEditingGateValue(val);
                                                setConfirmingGateRowNumber(null);
                                              }}
                                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900 whitespace-nowrap shrink-0 shadow-2xs"
                                            >
                                              <Pencil className="h-2.5 w-2.5" />
                                              <span>แก้ไข</span>
                                            </button>
                                          </div>
                                        )
                                      ) : activeTab.gid === '944294225' && col.id === 'Q' ? (
                                        (() => {
                                          const repairPhotos = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y']
                                            .map((cId) => (row.values[cId] ?? '').trim())
                                            .filter((v) => isPhotoValue(v))
                                            .sort((a, b) => {
                                              const aDirect = a.startsWith('data:image/') || a.startsWith('http') ? 0 : 1;
                                              const bDirect = b.startsWith('data:image/') || b.startsWith('http') ? 0 : 1;
                                              return aDirect - bDirect;
                                            });
                                          if (repairPhotos.length === 0) {
                                            return <span className="text-slate-400">-</span>;
                                          }
                                          return (
                                            <div className="flex items-center gap-1">
                                              {repairPhotos.slice(0, 2).map((pSrc, pIdx) => (
                                                <DrivePhotoImg
                                                  key={pIdx}
                                                  src={pSrc}
                                                  alt={`รูปงานซ่อม ${pIdx + 1}`}
                                                  className="h-9 w-12 rounded border border-slate-200 object-cover shrink-0"
                                                />
                                              ))}
                                              {repairPhotos.length > 2 && (
                                                <span className="inline-flex h-6 items-center rounded-md bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600 border border-slate-200 shrink-0">
                                                  +{repairPhotos.length - 2}
                                                </span>
                                              )}
                                            </div>
                                          );
                                        })()
                                      ) : isPhotoValue(val) ? (
                                        <DrivePhotoImg
                                          src={val}
                                          alt={col.label}
                                          className="h-9 w-12 rounded border border-slate-200 object-cover"
                                        />
                                      ) : activeTab.gid === '606634465' &&
                                        (col.id === 'M' || col.label.trim() === 'สถานะ') &&
                                        val.trim() ? (
                                        <span
                                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${
                                            getJobTransferStatusPriority(val) === 0
                                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                              : getJobTransferStatusPriority(val) === 1
                                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                                          }`}
                                        >
                                          <span
                                            className={`h-1.5 w-1.5 rounded-full ${
                                              getJobTransferStatusPriority(val) === 0
                                                ? 'bg-amber-500 animate-pulse'
                                                : getJobTransferStatusPriority(val) === 1
                                                ? 'bg-emerald-500'
                                                : 'bg-slate-400'
                                            }`}
                                          />
                                          {renderHighlightedText(val)}
                                        </span>
                                      ) : (
                                        renderHighlightedText(val)
                                      )}
                                    </td>
                                  );
                                })}
                                {activeTab.gid === '944294225' && (
                                  <td
                                    className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex items-center justify-center gap-1.5">
                                      {getRowApprovalStatus(row) === 'รอตรวจสอบ' && (
                                        <button
                                          type="button"
                                          onClick={() => setSelectedRow(row)}
                                          title="ผู้ตรวจสอบยืนยันข้อมูลเพื่อส่งต่ออนุมัติ"
                                          className="inline-flex items-center gap-1 rounded bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                                        >
                                          <CheckCircle2 className="h-3.5 w-3.5" />
                                          <span>ผู้ตรวจสอบ</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setSelectedRow(row)}
                                        title="ดูรายละเอียดทั้งหมด"
                                        className="inline-flex items-center gap-1 rounded bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                                      >
                                        <Eye className="h-3.5 w-3.5" />
                                        <span>รายละเอียด</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setAttachingPhotoRow(row)}
                                        title="แนบรูปเพิ่ม / แก้ไขรูปถ่าย"
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold transition-colors shadow-2xs"
                                      >
                                        <Camera className="h-3.5 w-3.5 text-slate-600" />
                                        <span>แนบรูป</span>
                                      </button>
                                    </div>
                                  </td>
                                )}
                                {activeTab.gid === '378250263' && (
                                  <td
                                    className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => setSelectedRow(row)}
                                      title="ดูข้อมูลเพิ่มเติมและแก้ไข"
                                      className="inline-flex items-center gap-1 rounded bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                      <span>เพิ่มเติม</span>
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                            {groupTotalPages > 1 && (
                              <tr className="bg-slate-50/80">
                                <td colSpan={colSpan} className="px-3 py-2 sm:px-4 sm:py-2.5">
                                  <div className="flex items-center justify-between text-xs text-slate-600">
                                    <div>
                                      แสดงรายการที่{' '}
                                      <span className="font-mono font-semibold text-slate-900">
                                        {((currentGroupPage - 1) * groupPageSize + 1).toLocaleString('th-TH')}
                                      </span>
                                      –
                                      <span className="font-mono font-semibold text-slate-900">
                                        {Math.min(currentGroupPage * groupPageSize, rows.length).toLocaleString('th-TH')}
                                      </span>{' '}
                                      จากทั้งหมด{' '}
                                      <span className="font-mono font-semibold text-slate-900">
                                        {rows.length.toLocaleString('th-TH')}
                                      </span>{' '}
                                      รายการในกลุ่มนี้
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={currentGroupPage <= 1}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setGroupPages((prev) => ({
                                            ...prev,
                                            [status]: Math.max(1, currentGroupPage - 1),
                                          }));
                                        }}
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                                      >
                                        <ChevronLeft className="h-3.5 w-3.5" />
                                        <span>ก่อนหน้า</span>
                                      </button>
                                      <span className="px-1.5 font-mono font-medium text-slate-700">
                                        {currentGroupPage}/{groupTotalPages}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={currentGroupPage >= groupTotalPages}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setGroupPages((prev) => ({
                                            ...prev,
                                            [status]: Math.min(groupTotalPages, currentGroupPage + 1),
                                          }));
                                        }}
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                                      >
                                        <span>ถัดไป</span>
                                        <ChevronRight className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  paginatedRows.map((row) => (
                    <tr
                      key={row.rowNumber}
                      onClick={() => setSelectedRow(row)}
                      className="cursor-pointer transition-colors hover:bg-slate-50"
                    >
                      {activeTab.gid !== '944294225' && (
                        <td
                          className={`px-2.5 py-2 sm:px-4 sm:py-2.5 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap ${
                            activeTab.gid === '1733355146' ? 'hidden sm:table-cell' : ''
                          }`}
                        >
                          <span>#{row.rowNumber.toLocaleString('th-TH')}</span>
                        </td>
                      )}
                      {sheetData?.columns.map((col) => {
                        const val = row.values[col.id] ?? '';
                        const isNumeric = col.type === 'number';
                        const isMono =
                          isNumeric ||
                          col.type === 'date' ||
                          col.type === 'datetime' ||
                          col.type === 'timeofday';

                        const isFuelTab = activeTab.gid === '1733355146';
                        const isFuelMainCol =
                          isFuelTab &&
                          (col.id === 'D' ||
                            col.id === 'E' ||
                            col.id === 'F' ||
                            col.id === 'G' ||
                            col.id === 'H' ||
                            col.label.includes('ชนิดน้ำมัน') ||
                            col.label.includes('รับเข้า') ||
                            col.label.includes('ราคา') ||
                            col.label.includes('จ่ายออก') ||
                            col.label.includes('มูลค่า'));
                        const isHiddenOnMobile = isFuelTab && !isFuelMainCol;

                        const isEditableGateCell =
                          activeTab.gid === '1156877149' && col.id === 'C';
                        const isEditableVehicleRegCell = false;
                        const isEditableJobNoteCell =
                          activeTab.gid === '606634465' && col.id === 'N';
                        const isEditableInlineCell =
                          isEditableGateCell ||
                          isEditableVehicleRegCell ||
                          isEditableJobNoteCell;
                        const isEditingThisRow =
                          isEditableInlineCell &&
                          editingGateRowNumber === row.rowNumber &&
                          editingColumnId === col.id;
                        const isConfirmingThisRow =
                          isEditableInlineCell &&
                          confirmingGateRowNumber === row.rowNumber &&
                          editingColumnId === col.id;
                        const isOver20MinDuration =
                          activeTab.gid === '606634465' &&
                          (col.id === 'L' || col.label === 'เวลาที่ใช้') &&
                          isDurationExceeding20Minutes(val);

                        return (
                          <td
                            key={col.id}
                            onClick={
                              isEditableInlineCell
                                ? (e) => {
                                    e.stopPropagation();
                                    if (!isEditingThisRow && !isConfirmingThisRow) {
                                      setEditingGateRowNumber(row.rowNumber);
                                      setEditingColumnId(col.id);
                                      setEditingGateValue(val);
                                      setConfirmingGateRowNumber(null);
                                    }
                                  }
                                : undefined
                            }
                            className={`px-2.5 py-2 sm:px-4 sm:py-2.5 ${
                              isHiddenOnMobile ? 'hidden sm:table-cell' : ''
                            } ${
                              isOver20MinDuration
                                ? 'bg-red-50 font-bold text-red-600'
                                : 'text-slate-800'
                            } ${
                              isEditableInlineCell
                                ? 'min-w-[220px] sm:min-w-[280px] cursor-pointer'
                                : 'max-w-[220px] sm:max-w-[260px] truncate'
                            } ${isNumeric ? 'text-right' : 'text-left'} ${
                              isMono ? 'font-mono text-xs tabular-nums' : 'text-xs sm:text-sm'
                            }`}
                            title={
                              isEditableInlineCell
                                ? 'คลิกเพื่อแก้ไขข้อมูลเพิ่มเติม'
                                : val
                            }
                          >
                            {isEditableInlineCell ? (
                              isConfirmingThisRow ? (
                                <div
                                  className="flex flex-wrap items-center gap-1.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span className="text-xs text-slate-700">
                                    ยืนยัน{' '}
                                    <strong className="font-semibold text-slate-900">
                                      {editingGateValue.trim() || '(ว่าง)'}
                                    </strong>
                                    ?
                                  </span>
                                  <button
                                    type="button"
                                    disabled={isUpdatingGate}
                                    onClick={() => handleConfirmGateUpdate(row)}
                                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    <Check className="h-3 w-3" />
                                    <span>
                                      {isUpdatingGate ? 'กำลังบันทึก...' : 'ยืนยัน'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isUpdatingGate}
                                    onClick={() => {
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    ย้อนกลับ
                                  </button>
                                </div>
                              ) : isEditingThisRow ? (
                                <div
                                  className="flex items-center gap-1.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editingGateValue}
                                    onChange={(e) => setEditingGateValue(e.target.value)}
                                    placeholder={
                                      isEditableJobNoteCell
                                        ? 'พิมพ์หมายเหตุ...'
                                        : undefined
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (
                                          (isEditableJobNoteCell ||
                                            editingGateValue.trim()) &&
                                          editingGateValue.trim() !== val.trim()
                                        ) {
                                          setConfirmingGateRowNumber(row.rowNumber);
                                        } else {
                                          setEditingGateRowNumber(null);
                                          setEditingColumnId(null);
                                        }
                                      } else if (e.key === 'Escape') {
                                        setEditingGateRowNumber(null);
                                        setEditingColumnId(null);
                                        setConfirmingGateRowNumber(null);
                                      }
                                    }}
                                    className="w-40 sm:w-52 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (
                                        (isEditableJobNoteCell ||
                                          editingGateValue.trim()) &&
                                        editingGateValue.trim() !== val.trim()
                                      ) {
                                        setConfirmingGateRowNumber(row.rowNumber);
                                      } else {
                                        setEditingGateRowNumber(null);
                                        setEditingColumnId(null);
                                      }
                                    }}
                                    className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                                  >
                                    บันทึก
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingGateRowNumber(null);
                                      setEditingColumnId(null);
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                                  >
                                    ยกเลิก
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between gap-1.5 group/cell hover:text-slate-900">
                                  <span className="truncate">{renderHighlightedText(val || '-')}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingGateRowNumber(row.rowNumber);
                                      setEditingColumnId(col.id);
                                      setEditingGateValue(val);
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900 whitespace-nowrap shrink-0 shadow-2xs"
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                    <span>แก้ไข</span>
                                  </button>
                                </div>
                              )
                            ) : activeTab.gid === '944294225' && col.id === 'Q' ? (
                              (() => {
                                const repairPhotos = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y']
                                  .map((cId) => (row.values[cId] ?? '').trim())
                                  .filter((v) => isPhotoValue(v))
                                  .sort((a, b) => {
                                    const aDirect = a.startsWith('data:image/') || a.startsWith('http') ? 0 : 1;
                                    const bDirect = b.startsWith('data:image/') || b.startsWith('http') ? 0 : 1;
                                    return aDirect - bDirect;
                                  });
                                if (repairPhotos.length === 0) {
                                  return <span className="text-slate-400">-</span>;
                                }
                                return (
                                  <div className="flex items-center gap-1">
                                    {repairPhotos.slice(0, 2).map((pSrc, pIdx) => (
                                      <DrivePhotoImg
                                        key={pIdx}
                                        src={pSrc}
                                        alt={`รูปงานซ่อม ${pIdx + 1}`}
                                        className="h-9 w-12 rounded border border-slate-200 object-cover shrink-0"
                                      />
                                    ))}
                                    {repairPhotos.length > 2 && (
                                      <span className="inline-flex h-6 items-center rounded-md bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600 border border-slate-200 shrink-0">
                                        +{repairPhotos.length - 2}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()
                            ) : isPhotoValue(val) ? (
                              <DrivePhotoImg
                                src={val}
                                alt={col.label}
                                className="h-9 w-12 rounded border border-slate-200 object-cover"
                              />
                            ) : (
                              renderHighlightedText(val)
                            )}
                          </td>
                        );
                      })}
                      {activeTab.gid === '944294225' && (
                        <td
                          className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            {getRowApprovalStatus(row) === 'รอตรวจสอบ' && (
                              <button
                                type="button"
                                onClick={() => setSelectedRow(row)}
                                title="ผู้ตรวจสอบยืนยันข้อมูลเพื่อส่งต่ออนุมัติ"
                                className="inline-flex items-center gap-1 rounded bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>ผู้ตรวจสอบ</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setSelectedRow(row)}
                              title="ดูรายละเอียดทั้งหมด"
                              className="inline-flex items-center gap-1 rounded bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>รายละเอียด</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setAttachingPhotoRow(row)}
                              title="แนบรูปเพิ่ม / แก้ไขรูปถ่าย"
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold transition-colors shadow-2xs"
                            >
                              <Camera className="h-3.5 w-3.5 text-slate-600" />
                              <span>แนบรูป</span>
                            </button>
                          </div>
                        </td>
                      )}
                      {activeTab.gid === '378250263' && (
                        <td
                          className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedRow(row)}
                            title="ดูข้อมูลเพิ่มเติมและแก้ไข"
                            className="inline-flex items-center gap-1 rounded bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>เพิ่มเติม</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Compact Pagination Footer */}
          {sheetData && sortedRows.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/50 px-3 py-2 sm:px-5 sm:py-2.5">
              <div className="text-[11px] sm:text-xs text-slate-600">
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {((currentPage - 1) * effectivePageSize + 1).toLocaleString('th-TH')}
                </span>
                –
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {Math.min(currentPage * effectivePageSize, sortedRows.length).toLocaleString(
                    'th-TH'
                  )}
                </span>{' '}
                / {' '}
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {sortedRows.length.toLocaleString('th-TH')}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">ก่อนหน้า</span>
                </button>

                <span className="px-1.5 font-mono text-xs font-medium text-slate-700 tabular-nums whitespace-nowrap">
                  {currentPage.toLocaleString('th-TH')}/{totalPages.toLocaleString('th-TH')}
                </span>

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <span className="hidden sm:inline">ถัดไป</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
        </main>

        {/* Android-Style Mobile Bottom Navigation Bar */}
        <nav
          aria-label="แถบเมนูด้านล่างสำหรับมือถือ"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/90 bg-white/95 backdrop-blur-md shadow-[0_-4px_16px_rgba(15,23,42,0.08)] pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-center px-1">
            {/* 1. หน้าหลัก / แดชบอร์ด */}
            {(() => {
              const isHomeActive =
                !isApprovalModalOpen &&
                activeTab.gid !== '944294225' &&
                activeTab.gid !== '606634465' &&
                activeTab.gid !== '1733355146';
              return (
                <button
                  type="button"
                  onClick={() => {
                    const dashboardTab =
                      SHEET_TABS.find((t) => t.gid === '378250263') ?? SHEET_TABS[0];
                    if (activeTab.gid === dashboardTab.gid) {
                      setIsSidebarOpen((prev) => !prev);
                    } else {
                      handleSelectTab(dashboardTab);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`group flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                    isHomeActive
                      ? 'text-blue-700'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`flex h-7 w-12 items-center justify-center rounded-full transition-all ${
                      isHomeActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'group-hover:bg-slate-100'
                    }`}
                  >
                    <Home className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] leading-tight tracking-tight ${
                      isHomeActive ? 'font-bold text-blue-700' : 'font-medium'
                    }`}
                  >
                    หน้าหลัก
                  </span>
                </button>
              );
            })()}

            {/* 2. บันทึกงานซ่อม */}
            {(() => {
              const isRepairActive =
                !isApprovalModalOpen && activeTab.gid === '944294225';
              return (
                <button
                  type="button"
                  onClick={() => {
                    const repairTab = SHEET_TABS.find((t) => t.gid === '944294225');
                    if (repairTab) {
                      handleSelectTab(repairTab);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`group relative flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                    isRepairActive
                      ? 'text-amber-700'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-all ${
                      isRepairActive
                        ? 'bg-amber-100 text-amber-700'
                        : 'group-hover:bg-slate-100'
                    }`}
                  >
                    <Wrench className="h-4 w-4" />
                    {pendingApprovalCount > 0 && (
                      <span className="absolute -top-1 -right-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 py-0.2 font-mono text-[9px] font-bold leading-tight text-white shadow-xs">
                        {pendingApprovalCount > 99
                          ? '99+'
                          : pendingApprovalCount.toLocaleString('th-TH')}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] leading-tight tracking-tight ${
                      isRepairActive ? 'font-bold text-amber-700' : 'font-medium'
                    }`}
                  >
                    บันทึกงานซ่อม
                  </span>
                </button>
              );
            })()}

            {/* 3. บันทึกการย้ายงาน */}
            {(() => {
              const isTransferActive =
                !isApprovalModalOpen && activeTab.gid === '606634465';
              return (
                <button
                  type="button"
                  onClick={() => {
                    const transferTab = SHEET_TABS.find((t) => t.gid === '606634465');
                    if (transferTab) {
                      handleSelectTab(transferTab);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`group flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                    isTransferActive
                      ? 'text-indigo-700'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`flex h-7 w-12 items-center justify-center rounded-full transition-all ${
                      isTransferActive
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'group-hover:bg-slate-100'
                    }`}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] leading-tight tracking-tight ${
                      isTransferActive ? 'font-bold text-indigo-700' : 'font-medium'
                    }`}
                  >
                    ย้ายงาน
                  </span>
                </button>
              );
            })()}

            {/* 4. บันทึกน้ำมัน */}
            {(() => {
              const isFuelActive =
                !isApprovalModalOpen && activeTab.gid === '1733355146';
              return (
                <button
                  type="button"
                  onClick={() => {
                    const fuelTab = SHEET_TABS.find((t) => t.gid === '1733355146');
                    if (fuelTab) {
                      handleSelectTab(fuelTab);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`group flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                    isFuelActive
                      ? 'text-sky-700'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`flex h-7 w-12 items-center justify-center rounded-full transition-all ${
                      isFuelActive
                        ? 'bg-sky-100 text-sky-700'
                        : 'group-hover:bg-slate-100'
                    }`}
                  >
                    <Fuel className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] leading-tight tracking-tight ${
                      isFuelActive ? 'font-bold text-sky-700' : 'font-medium'
                    }`}
                  >
                    บันทึกน้ำมัน
                  </span>
                </button>
              );
            })()}

            {/* 5. เมนูจัดการอนุมัติ (ผู้จัดการ) */}
            <button
              type="button"
              onClick={() => {
                setIsSidebarOpen(false);
                setIsApprovalModalOpen(true);
              }}
              className={`group relative flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                isApprovalModalOpen
                  ? 'text-emerald-700'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <div
                className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-all ${
                  isApprovalModalOpen
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'group-hover:bg-slate-100'
                }`}
              >
                <CheckCircle className="h-4 w-4" />
                {pendingApprovalCount > 0 && (
                  <span className="absolute -top-1 -right-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 py-0.2 font-mono text-[9px] font-bold leading-tight text-white animate-pulse shadow-xs">
                    {pendingApprovalCount > 99
                      ? '99+'
                      : pendingApprovalCount.toLocaleString('th-TH')}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] leading-tight tracking-tight ${
                  isApprovalModalOpen ? 'font-bold text-emerald-700' : 'font-medium'
                }`}
              >
                อนุมัติซ่อม
              </span>
            </button>
          </div>
        </nav>
      </div>

      {/* Record Detail Modal */}
      <RecordDetailModal
        row={selectedRow}
        columns={sheetData?.allColumns ?? sheetData?.columns ?? []}
        tabName={activeTab.name}
        onClose={() => setSelectedRow(null)}
        onOpenAttachPhotos={(row) => setAttachingPhotoRow(row)}
        onUpdateAdditionalDetails={async (row, newDetails) => {
          const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
          const repairRequestNo = (row.values['G'] ?? '').trim();
          await updateRepairAdditionalDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            additionalDetails: newDetails,
          });
          row.values['AK'] = newDetails;
          setSaveSuccessMsg(
            newDetails
              ? `บันทึกรายละเอียดเพิ่มเติมเรียบร้อยแล้ว`
              : `ล้างรายละเอียดเพิ่มเติมเรียบร้อยแล้ว`
          );
          loadData({ silent: true });
          setTimeout(() => setSaveSuccessMsg(null), 5000);
        }}
        onUpdateReplyDetails={async (row, newReply) => {
          const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
          const repairRequestNo = (row.values['G'] ?? '').trim();
          await updateRepairReplyDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            replyDetails: newReply,
          });
          row.values['AM'] = newReply;
          setSaveSuccessMsg(
            newReply
              ? `บันทึกตอบกลับข้อมูลเพิ่มเติมเรียบร้อยแล้ว`
              : `ล้างตอบกลับข้อมูลเพิ่มเติมเรียบร้อยแล้ว`
          );
          loadData({ silent: true });
          setTimeout(() => setSaveSuccessMsg(null), 5000);
        }}
        onUpdateFinancialDetails={async (row, spareParts, labor) => {
          const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
          const repairRequestNo = (row.values['G'] ?? '').trim();
          await updateRepairFinancialDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            sparePartsCost: spareParts,
            laborCost: labor,
          });
          row.values['N'] = spareParts;
          row.values['O'] = labor;
          setSaveSuccessMsg('อัปเดตค่าอะไหล่และค่าแรงเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => setSaveSuccessMsg(null), 5000);
        }}
        onUpdateVehicleField={async (row, colId, newValue) => {
          const oldReg = (row.values['A'] ?? '').trim();
          const drvName = (row.values['I'] ?? '').trim();
          const shf = (row.values['L'] ?? '').trim();
          const saved = await updateVehicleField({
            rowNumber: row.rowNumber,
            colId,
            newValue,
            oldRegistration: oldReg,
            driverName: drvName,
            shift: shf,
          });
          row.values[colId] = saved;
          row.rawValues[colId] = saved;
          setSaveSuccessMsg('อัปเดตข้อมูลฐานข้อมูลรถเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => setSaveSuccessMsg(null), 5000);
          return saved;
        }}
        onInspectRepair={async (row, inspectorName) => {
          const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
          const repairRequestNo = (row.values['G'] ?? '').trim();
          const now = new Date();
          const dd = String(now.getDate()).padStart(2, '0');
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const yyyy = String(now.getFullYear());
          const inspectionDate = `${dd}/${mm}/${yyyy}`;
          const hh = String(now.getHours()).padStart(2, '0');
          const min = String(now.getMinutes()).padStart(2, '0');
          const ss = String(now.getSeconds()).padStart(2, '0');
          const inspectionTime = `${hh}:${min}:${ss}`;

          await inspectRepairRecord({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            inspectorName,
            inspectionDate,
            inspectionTime,
          });

          row.values['AB'] = inspectorName;
          row.values['AC'] = inspectionDate;
          row.values['AD'] = inspectionTime;
          row.values['P'] = 'ตรวจสอบแล้ว';
          row.values['AI'] = '2.⚠️รออนุมัติ';
          setSaveSuccessMsg('ผู้ตรวจสอบยืนยันข้อมูลแล้ว ส่งต่อไปยังสถานะ รออนุมัติ เรียบร้อย');
          loadData({ silent: true });
          setTimeout(() => loadData({ silent: true }), 6000);
          setTimeout(() => setSaveSuccessMsg(null), 5000);
        }}
      />

      {/* Attach / Edit Repair Photos Modal */}
      <AttachRepairPhotosModal
        isOpen={attachingPhotoRow !== null}
        row={attachingPhotoRow}
        onClose={() => setAttachingPhotoRow(null)}
        onPhotosUpdated={(updatedPhotos) => {
          setSaveSuccessMsg('อัปเดตรูปถ่ายเพิ่มเติมในแถวเดิมเรียบร้อยแล้ว');
          if (
            selectedRow &&
            attachingPhotoRow &&
            selectedRow.rowNumber === attachingPhotoRow.rowNumber
          ) {
            const updatedValues = { ...selectedRow.values };
            const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
            photoCols.forEach((col, idx) => {
              updatedValues[col] = (updatedPhotos[idx] ?? '').trim();
            });
            setSelectedRow({
              ...selectedRow,
              values: updatedValues,
            });
          }
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Job Transfer Creation Modal */}
      <JobTransferModal
        isOpen={isJobModalOpen}
        onClose={() => setIsJobModalOpen(false)}
        existingRows={activeTab.gid === '606634465' ? sheetData?.rows ?? [] : []}
        onSavedSuccess={() => {
          setSaveSuccessMsg('บันทึกข้อมูลการย้ายงานลงฐานข้อมูลเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Delivery Point Creation Modal */}
      <DeliveryPointModal
        isOpen={isDeliveryPointModalOpen}
        onClose={() => setIsDeliveryPointModalOpen(false)}
        existingRows={activeTab.gid === '1156877149' ? sheetData?.rows ?? [] : []}
        onSavedSuccess={() => {
          setSaveSuccessMsg('เพิ่มข้อมูลจุดส่งสินค้าลงฐานข้อมูลเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Fuel Receive/Issue Modal */}
      <FuelRecordModal
        isOpen={isFuelModalOpen}
        onClose={() => setIsFuelModalOpen(false)}
        existingRows={activeTab.gid === '1733355146' ? sheetData?.rows ?? [] : []}
        onSavedSuccess={() => {
          setSaveSuccessMsg('บันทึกข้อมูลน้ำมัน (รับเข้า-เบิกออก) ลงฐานข้อมูลเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* No-Login Google Sheets Webhook Setup Modal */}
      <SheetWebhookModal
        isOpen={isWebhookModalOpen}
        onClose={() => setIsWebhookModalOpen(false)}
        onSaved={() => {
          setSaveSuccessMsg('บันทึกการเชื่อมต่อ Google Sheets (ไม่ต้องล็อกอิน) เรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Repair Request Modal */}
      <RepairRequestModal
        isOpen={isRepairModalOpen}
        onClose={() => setIsRepairModalOpen(false)}
        existingRows={activeTab.gid === '944294225' ? (sheetData?.rows ?? repairTabRows) : repairTabRows}
        onSavedSuccess={() => {
          setSaveSuccessMsg('บันทึกข้อมูลแจ้งซ่อมเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => loadData({ silent: true }), 6000);
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Manager Approval Modal */}
      <ManagerApprovalModal
        isOpen={isApprovalModalOpen}
        onClose={() => setIsApprovalModalOpen(false)}
        rows={activeTab.gid === '944294225' ? (sheetData?.rows ?? repairTabRows) : repairTabRows}
        onApprovedSuccess={() => {
          setSaveSuccessMsg('บันทึกผลการพิจารณาอนุมัติงานซ่อมเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => loadData({ silent: true }), 6000);
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />
    </div>
  );
}
