import React, { useState, useMemo, useEffect } from 'react';
import { X, AlertCircle, Fuel, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { FuelRecordPayload, SheetRow } from '../types';
import { appendFuelRecord, fetchSheetTabData, SHEET_TABS } from '../services/googleSheets';
import { showSuccessToast } from '../utils/swal';

interface FuelRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRows: SheetRow[];
  onSavedSuccess: () => void;
}

const THAI_MONTH_LABELS: Record<number, string> = {
  1: '1.มกราคม',
  2: '2.กุมภาพันธ์',
  3: '3.มีนาคม',
  4: '4.เมษายน',
  5: '5.พฤษภาคม',
  6: '6.มิถุนายน',
  7: '7.กรกฎาคม',
  8: '8.สิงหาคม',
  9: '9.กันยายน',
  10: '10.ตุลาคม',
  11: '11.พฤศจิกายน',
  12: '12.ธันวาคม',
};

function getCurrentThaiDateString(): string {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const buddhistYear = now.getFullYear() + 543;
  return `${day}/${month}/${buddhistYear}`;
}

function getCurrentTimeString(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getMonthLabelFromDateStr(dateStr: string): string {
  const parts = dateStr.trim().split(/[/-]/);
  if (parts.length >= 2) {
    const m = parseInt(parts[1], 10);
    if (THAI_MONTH_LABELS[m]) {
      return THAI_MONTH_LABELS[m];
    }
  }
  const currentMonth = new Date().getMonth() + 1;
  return THAI_MONTH_LABELS[currentMonth] || `${currentMonth}`;
}

function parseNumericCell(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

export const FuelRecordModal: React.FC<FuelRecordModalProps> = ({
  isOpen,
  onClose,
  existingRows,
  onSavedSuccess,
}) => {
  const [transactionType, setTransactionType] = useState<'เบิกออก' | 'รับเข้า'>('เบิกออก');
  const [date, setDate] = useState<string>(getCurrentThaiDateString());
  const [time, setTime] = useState<string>(getCurrentTimeString());
  const [fuelType, setFuelType] = useState<'ดีเซล' | 'เบนซิน'>('ดีเซล');
  const [liters, setLiters] = useState<string>('');
  const [pricePerLiter, setPricePerLiter] = useState<string>('');
  const [vehicleNumber, setVehicleNumber] = useState<string>('');
  const [mileage, setMileage] = useState<string>('');
  const [driverName, setDriverName] = useState<string>('');
  const [staffName, setStaffName] = useState<string>('');
  const [requisitionNo, setRequisitionNo] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const [isConfirmStep, setIsConfirmStep] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Extract latest running balances, latest fuel prices, and reference options from real sheet rows
  const sheetContext = useMemo(() => {
    const rowsByNewest = [...existingRows].sort((a, b) => b.rowNumber - a.rowNumber);

    let prevTotalInDiesel = 0;
    let prevTotalInBenzene = 0;
    let prevTotalOutDiesel = 0;
    let prevTotalOutBenzene = 0;
    let prevBalanceDiesel = 0;
    let prevBalanceBenzene = 0;

    const latestTotalRow = rowsByNewest.find(
      (r) =>
        (r.values['I'] ?? '').trim() !== '' ||
        (r.values['M'] ?? '').trim() !== '' ||
        (r.values['N'] ?? '').trim() !== ''
    );

    if (latestTotalRow) {
      prevTotalInDiesel = parseNumericCell(latestTotalRow.values['I']);
      prevTotalInBenzene = parseNumericCell(latestTotalRow.values['J']);
      prevTotalOutDiesel = parseNumericCell(latestTotalRow.values['K']);
      prevTotalOutBenzene = parseNumericCell(latestTotalRow.values['L']);
      prevBalanceDiesel = parseNumericCell(latestTotalRow.values['M']);
      prevBalanceBenzene = parseNumericCell(latestTotalRow.values['N']);
    }

    let latestDieselPrice = '';
    let latestBenzenePrice = '';

    const vehicles = new Set<string>();
    const drivers = new Set<string>();
    const staffNames = new Set<string>();
    const vehicleToDriverMap = new Map<string, string>();
    const vehicleToMileageMap = new Map<string, string>();
    const vehicleToFuelMap = new Map<string, 'ดีเซล' | 'เบนซิน'>();

    rowsByNewest.forEach((row) => {
      const fType = (row.values['D'] ?? '').trim();
      const priceStr = (row.values['F'] ?? '').replace(/,/g, '').trim();
      if (fType === 'ดีเซล' && !latestDieselPrice && priceStr && Number(priceStr) > 0) {
        latestDieselPrice = priceStr;
      }
      if (
        (fType === 'เบนซิน' || fType === 'เบนซิล') &&
        !latestBenzenePrice &&
        priceStr &&
        Number(priceStr) > 0
      ) {
        latestBenzenePrice = priceStr;
      }

      const veh = (row.values['O'] ?? '').trim();
      const drv = (row.values['Q'] ?? '').trim();
      const mil = (row.values['P'] ?? '').replace(/,/g, '').trim();
      const iss = (row.values['R'] ?? '').trim();
      const rec = (row.values['T'] ?? '').trim();

      if (veh) {
        vehicles.add(veh);
        if (drv && !vehicleToDriverMap.has(veh)) {
          vehicleToDriverMap.set(veh, drv);
        }
        if (mil && !vehicleToMileageMap.has(veh)) {
          vehicleToMileageMap.set(veh, mil);
        }
        if ((fType === 'ดีเซล' || fType === 'เบนซิน') && !vehicleToFuelMap.has(veh)) {
          vehicleToFuelMap.set(veh, fType);
        }
      }
      if (drv) drivers.add(drv);
      if (iss) staffNames.add(iss);
      if (rec) staffNames.add(rec);
    });

    return {
      prevTotalInDiesel,
      prevTotalInBenzene,
      prevTotalOutDiesel,
      prevTotalOutBenzene,
      prevBalanceDiesel,
      prevBalanceBenzene,
      latestDieselPrice,
      latestBenzenePrice,
      vehicles: Array.from(vehicles),
      drivers: Array.from(drivers),
      staffNames: Array.from(staffNames),
      vehicleToDriverMap,
      vehicleToMileageMap,
      vehicleToFuelMap,
    };
  }, [existingRows]);

  const [vehicleDbRows, setVehicleDbRows] = useState<SheetRow[]>([]);

  // Load ฐานข้อมูลรถ (gid: 378250263) when modal is opened
  useEffect(() => {
    if (!isOpen) return;
    const vehicleTab = SHEET_TABS.find((t) => t.gid === '378250263');
    if (!vehicleTab) return;
    let cancelled = false;
    void fetchSheetTabData(vehicleTab, { limit: 300 })
      .then((res) => {
        if (!cancelled && res.rows.length > 0) {
          setVehicleDbRows(res.rows);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Compute driver options from ฐานข้อมูลรถ (Column I: ชื่อพนักงานประจำรถ, Column L: กะทำงาน === 'กะเช้า')
  const driverOptions = useMemo(() => {
    const driverSet = new Set<string>();

    if (vehicleDbRows.length > 0) {
      vehicleDbRows.forEach((row) => {
        const name = (row.values['I'] ?? row.values['ชื่อพนักงานประจำรถ'] ?? '').trim();
        const shift = (row.values['L'] ?? row.values['กะทำงาน'] ?? '').trim();

        // กรองเฉพาะคอลัมน์ "กะทำงาน" ที่เป็น "กะเช้า" เท่านั้น
        const isDayShift = shift === 'กะเช้า' || shift.includes('กะเช้า');

        if (name && name !== '-' && isDayShift) {
          driverSet.add(name);
        }
      });
    } else {
      // Fallback while loading vehicleDbRows
      sheetContext.drivers.forEach((drv) => {
        if (drv && drv !== '-') {
          driverSet.add(drv);
        }
      });
    }

    return Array.from(driverSet).sort((a, b) => a.localeCompare(b, 'th'));
  }, [vehicleDbRows, sheetContext.drivers]);

  useEffect(() => {
    if (isOpen) {
      setDate(getCurrentThaiDateString());
      setTime(getCurrentTimeString());
      setIsConfirmStep(false);
      setSubmitError(null);
      if (fuelType === 'ดีเซล' && sheetContext.latestDieselPrice) {
        setPricePerLiter(sheetContext.latestDieselPrice);
      } else if (fuelType === 'เบนซิน' && sheetContext.latestBenzenePrice) {
        setPricePerLiter(sheetContext.latestBenzenePrice);
      }
    }
  }, [isOpen, sheetContext.latestDieselPrice, sheetContext.latestBenzenePrice]);

  if (!isOpen) return null;

  const handleFuelTypeChange = (nextFuel: 'ดีเซล' | 'เบนซิน') => {
    setFuelType(nextFuel);
    if (nextFuel === 'ดีเซล' && sheetContext.latestDieselPrice) {
      setPricePerLiter(sheetContext.latestDieselPrice);
    } else if (nextFuel === 'เบนซิน' && sheetContext.latestBenzenePrice) {
      setPricePerLiter(sheetContext.latestBenzenePrice);
    }
  };

  const handleVehicleChange = (val: string) => {
    setVehicleNumber(val);
    const trimmed = val.trim();
    if (!trimmed) return;

    let mappedDriver: string | undefined;
    if (vehicleDbRows.length > 0) {
      const match = vehicleDbRows.find(
        (r) => (r.values['A'] ?? r.values['ทะเบียนรถ'] ?? '').trim() === trimmed
      );
      if (match) {
        const dName = (match.values['I'] ?? match.values['ชื่อพนักงานประจำรถ'] ?? '').trim();
        if (dName && dName !== '-') mappedDriver = dName;
      }
    }
    if (!mappedDriver) {
      mappedDriver = sheetContext.vehicleToDriverMap.get(trimmed);
    }
    if (mappedDriver) {
      setDriverName(mappedDriver);
    }
    const mappedFuel = sheetContext.vehicleToFuelMap.get(trimmed);
    if (mappedFuel) {
      handleFuelTypeChange(mappedFuel);
    }
  };

  const numericLiters = parseNumericCell(liters);
  const numericPrice = parseNumericCell(pricePerLiter);
  const calculatedAmountBaht =
    numericLiters > 0 && numericPrice > 0
      ? Number((numericLiters * numericPrice).toFixed(2))
      : 0;

  const isReceive = transactionType === 'รับเข้า';
  const nextTotalInDiesel =
    isReceive && fuelType === 'ดีเซล'
      ? Number((sheetContext.prevTotalInDiesel + numericLiters).toFixed(2))
      : sheetContext.prevTotalInDiesel;
  const nextTotalInBenzene =
    isReceive && fuelType === 'เบนซิน'
      ? Number((sheetContext.prevTotalInBenzene + numericLiters).toFixed(2))
      : sheetContext.prevTotalInBenzene;
  const nextTotalOutDiesel =
    !isReceive && fuelType === 'ดีเซล'
      ? Number((sheetContext.prevTotalOutDiesel + numericLiters).toFixed(2))
      : sheetContext.prevTotalOutDiesel;
  const nextTotalOutBenzene =
    !isReceive && fuelType === 'เบนซิน'
      ? Number((sheetContext.prevTotalOutBenzene + numericLiters).toFixed(2))
      : sheetContext.prevTotalOutBenzene;

  const nextBalanceDiesel = Number((nextTotalInDiesel - nextTotalOutDiesel).toFixed(2));
  const nextBalanceBenzene = Number((nextTotalInBenzene - nextTotalOutBenzene).toFixed(2));

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!date.trim()) {
      setSubmitError('กรุณาระบุวันที่');
      return;
    }
    if (!time.trim()) {
      setSubmitError('กรุณาระบุเวลา');
      return;
    }
    if (numericLiters <= 0) {
      setSubmitError(
        isReceive ? 'กรุณาระบุจำนวนลิตรที่รับเข้า (มากกว่า 0)' : 'กรุณาระบุจำนวนลิตรที่เบิกออก (มากกว่า 0)'
      );
      return;
    }

    if (!isReceive) {
      if (!vehicleNumber.trim()) {
        setSubmitError('กรุณาระบุเบอร์รถที่เบิกน้ำมัน');
        return;
      }
      if (!driverName.trim()) {
        setSubmitError('กรุณาระบุชื่อพนักงานขับรถ');
        return;
      }
      if (!staffName.trim()) {
        setSubmitError('กรุณาระบุชื่อผู้จ่ายน้ำมัน');
        return;
      }
    } else {
      if (!staffName.trim()) {
        setSubmitError('กรุณาระบุชื่อผู้รับเข้า / ผู้ทำรายการ');
        return;
      }
    }

    setIsConfirmStep(true);
  };

  const handleConfirmedSave = async () => {
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const payload: FuelRecordPayload = {
        transactionType,
        date: date.trim(),
        time: time.trim(),
        fuelType,
        litersIn: isReceive ? numericLiters : '',
        pricePerLiter: numericPrice > 0 ? numericPrice : '',
        litersOut: !isReceive ? numericLiters : '',
        amountBaht: isReceive ? 0 : calculatedAmountBaht,
        totalInDiesel: nextTotalInDiesel,
        totalInBenzene: nextTotalInBenzene,
        totalOutDiesel: nextTotalOutDiesel,
        totalOutBenzene: nextTotalOutBenzene,
        balanceDiesel: nextBalanceDiesel,
        balanceBenzene: nextBalanceBenzene,
        vehicleNumber: !isReceive ? vehicleNumber.trim() : '',
        mileage: !isReceive && mileage.trim() ? parseNumericCell(mileage) : '',
        driverName: !isReceive ? driverName.trim() : '',
        issuerName: staffName.trim(),
        receiverName: isReceive ? staffName.trim() : '',
        requisitionNo: requisitionNo.trim(),
        note: note.trim(),
        monthLabel: getMonthLabelFromDateStr(date),
      };

      await appendFuelRecord(payload);

      setLiters('');
      setVehicleNumber('');
      setMileage('');
      setDriverName('');
      setRequisitionNo('');
      setNote('');
      setIsConfirmStep(false);

      showSuccessToast(
        `บันทึกน้ำมัน (${transactionType}) สำเร็จ!`,
        `${fuelType} จำนวน ${numericLiters.toLocaleString('th-TH')} ลิตร`
      );

      onSavedSuccess();
      onClose();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการบันทึกข้อมูลน้ำมันลง Google Sheets'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4 backdrop-blur-xs"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 sm:px-5 sm:py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <Fuel className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 sm:text-base">
                {isConfirmStep
                  ? `ยืนยันบันทึกน้ำมัน (${transactionType})`
                  : 'บันทึกน้ำมัน (รับเข้า - เบิกออก)'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="ปิดหน้าต่าง"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error Banner */}
        {submitError && (
          <div className="mx-4 mt-2.5 sm:mx-5 sm:mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {isConfirmStep ? (
          <div className="overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-1.5 text-xs sm:text-sm">
              <div className="flex justify-between py-2">
                <span className="text-slate-500">ประเภทรายการ (STATUS)</span>
                <span
                  className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold ${
                    isReceive
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {transactionType}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">วันที่ / เวลา</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {date} {time}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">ชนิดน้ำมัน</span>
                <span className="font-semibold text-slate-900">{fuelType}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">
                  {isReceive ? 'รับเข้า / ลิตร' : 'จ่ายออก / ลิตร'}
                </span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {numericLiters.toLocaleString('th-TH')} ลิตร
                </span>
              </div>
              {numericPrice > 0 && (
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">ราคาต่อลิตร</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {numericPrice.toLocaleString('th-TH', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    บาท
                  </span>
                </div>
              )}
              {!isReceive && calculatedAmountBaht > 0 && (
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">มูลค่า / บาท</span>
                  <span className="font-mono font-bold text-sky-700 tabular-nums">
                    {calculatedAmountBaht.toLocaleString('th-TH', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    บาท
                  </span>
                </div>
              )}
              {!isReceive && (
                <>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">เบอร์รถ</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {vehicleNumber}
                    </span>
                  </div>
                  {mileage.trim() && (
                    <div className="flex justify-between py-2">
                      <span className="text-slate-500">เลขไมล์</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {parseNumericCell(mileage).toLocaleString('th-TH', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">พนักงานขับรถ</span>
                    <span className="font-semibold text-slate-900">{driverName}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between py-2">
                <span className="text-slate-500">
                  {isReceive ? 'ผู้รับเข้า / ผู้ทำรายการ' : 'ผู้จ่ายน้ำมัน'}
                </span>
                <span className="font-semibold text-slate-900">{staffName}</span>
              </div>
              {requisitionNo.trim() && (
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">เลขที่ใบเบิก</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {requisitionNo}
                  </span>
                </div>
              )}
              {note.trim() && (
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">หมายเหตุ</span>
                  <span className="font-semibold text-slate-900">{note}</span>
                </div>
              )}
              <div className="flex justify-between py-2 bg-white/80 px-2 rounded mt-1">
                <span className="text-slate-600 font-medium">
                  คงเหลือหลังทำรายการ ({fuelType})
                </span>
                <span className="font-mono font-bold text-emerald-700 tabular-nums">
                  {(fuelType === 'ดีเซล' ? nextBalanceDiesel : nextBalanceBenzene).toLocaleString(
                    'th-TH'
                  )}{' '}
                  ลิตร
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmStep(false)}
                disabled={isSubmitting}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                แก้ไข
              </button>
              <button
                type="button"
                onClick={handleConfirmedSave}
                disabled={isSubmitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันบันทึกข้อมูล'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleReviewSubmit} className="overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
            <div className="space-y-3">
              {/* Toggle: เบิกออก vs รับเข้า */}
              <div>
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700 mb-1">
                  ประเภทรายการ (STATUS) <span className="text-red-600">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTransactionType('เบิกออก')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                      transactionType === 'เบิกออก'
                        ? 'border-amber-600 bg-amber-600 text-white shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <ArrowUpFromLine className="h-4 w-4" />
                    <span>เบิกออก (จ่ายน้ำมัน)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransactionType('รับเข้า')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                      transactionType === 'รับเข้า'
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                    <span>รับเข้า (เติมสต็อก)</span>
                  </button>
                </div>
              </div>

              {/* Current Stock Summary Strip */}
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
                <div className="flex items-center justify-between px-1">
                  <span className="text-slate-500">คงเหลือ ดีเซล:</span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {sheetContext.prevBalanceDiesel.toLocaleString('th-TH')} ลิตร
                  </span>
                </div>
                <div className="flex items-center justify-between border-l border-slate-200 pl-2.5 pr-1">
                  <span className="text-slate-500">คงเหลือ เบนซิน:</span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {sheetContext.prevBalanceBenzene.toLocaleString('th-TH')} ลิตร
                  </span>
                </div>
              </div>

              {/* วันที่ & เวลา */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                    วันที่ <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    placeholder="6/11/2569"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                    เวลา <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="18:30:00"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* ชนิดน้ำมัน */}
              <div>
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700 mb-1">
                  ชนิดน้ำมัน <span className="text-red-600">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['ดีเซล', 'เบนซิน'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleFuelTypeChange(type)}
                      className={`rounded-lg border px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors ${
                        fuelType === type
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* จำนวนลิตร & ราคาต่อลิตร */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                    {isReceive ? 'รับเข้า / ลิตร' : 'จ่ายออก / ลิตร'}{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    required
                    value={liters}
                    onChange={(e) => setLiters(e.target.value)}
                    placeholder={isReceive ? 'เช่น 200' : 'เช่น 20'}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                    ราคาต่อลิตร (บาท)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={pricePerLiter}
                    onChange={(e) => setPricePerLiter(e.target.value)}
                    placeholder="เช่น 41.79"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* มูลค่ารวม & ยอดคงเหลือหลังทำรายการ */}
              {numericLiters > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs">
                  <div>
                    <span className="text-slate-600">มูลค่ารวม: </span>
                    <span className="font-mono font-bold text-sky-800 tabular-nums">
                      {calculatedAmountBaht.toLocaleString('th-TH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      บาท
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600">คงเหลือ {fuelType}: </span>
                    <span className="font-mono font-bold text-emerald-700 tabular-nums">
                      {(fuelType === 'ดีเซล'
                        ? nextBalanceDiesel
                        : nextBalanceBenzene
                      ).toLocaleString('th-TH')}{' '}
                      ลิตร
                    </span>
                  </div>
                </div>
              )}

              {/* ฟิลด์เฉพาะกรณี เบิกออก */}
              {!isReceive && (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                        เบอร์รถ <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        list="datalist-fuel-vehicles"
                        value={vehicleNumber}
                        onChange={(e) => handleVehicleChange(e.target.value)}
                        placeholder="เช่น TT-04, FL-9"
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                      <datalist id="datalist-fuel-vehicles">
                        {sheetContext.vehicles.map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                        เลขไมล์
                        {vehicleNumber &&
                          sheetContext.vehicleToMileageMap.get(vehicleNumber.trim()) && (
                            <span className="ml-1 font-mono text-[10px] text-slate-400">
                              (ล่าสุด:{' '}
                              {sheetContext.vehicleToMileageMap.get(vehicleNumber.trim())})
                            </span>
                          )}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={mileage}
                        onChange={(e) => setMileage(e.target.value)}
                        placeholder="เช่น 34131.40"
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                      พนักงานขับรถ <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      list="datalist-fuel-drivers"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      placeholder="เลือกหรือพิมพ์ชื่อพนักงานขับรถ"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                    <datalist id="datalist-fuel-drivers">
                      {driverOptions.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>
                </>
              )}

              {/* ผู้จ่ายน้ำมัน / ผู้รับเข้า & เลขที่ใบเบิก */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                    {isReceive ? 'ผู้รับเข้า / ผู้ทำรายการ' : 'ผู้จ่ายน้ำมัน'}{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    list="datalist-fuel-staff"
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    placeholder={
                      isReceive ? 'ระบุชื่อผู้รับน้ำมันเข้า' : 'ระบุชื่อผู้จ่ายน้ำมัน'
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                  <datalist id="datalist-fuel-staff">
                    {sheetContext.staffNames.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                    เลขที่ใบเบิก / เลขที่อ้างอิง
                  </label>
                  <input
                    type="text"
                    value={requisitionNo}
                    onChange={(e) => setRequisitionNo(e.target.value)}
                    placeholder="เช่น 1838700"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* หมายเหตุ */}
              <div>
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                  หมายเหตุ
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="ระบุหมายเหตุเพิ่มเติม (ถ้ามี)"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                ตรวจสอบและบันทึก
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
