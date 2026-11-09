import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, AlertCircle, Wrench, Send, Camera, Image as ImageIcon, Trash2 } from 'lucide-react';
import { SheetRow, RepairRequestPayload } from '../types';
import { appendRepairRecord } from '../services/googleSheets';
import { showSuccessToast } from '../utils/swal';

interface RepairRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRows: SheetRow[];
  onSavedSuccess: () => void;
}

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

function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_CHARS = 45000;
        let maxDim = 800;
        let quality = 0.65;
        let dataUrl = '';

        while (maxDim >= 320) {
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDim) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }

          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          dataUrl = canvas.toDataURL('image/jpeg', quality);

          if (dataUrl.length <= MAX_CHARS) {
            break;
          }
          maxDim = Math.round(maxDim * 0.78);
          quality = Math.max(0.45, quality - 0.08);
        }

        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function generateNextRepairRequestNo(existingRows: SheetRow[]): string {
  const now = new Date();
  const monthStr = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `TMT-FL${monthStr}`;

  let maxSeq = 0;
  existingRows.forEach((r) => {
    const val = (r.values['G'] ?? '').trim();
    if (!val) return;

    // Pattern 1: TMT-FL{month}-{seq} or TMT-FL{month}{seq}
    const matchFl = val.match(new RegExp(`^TMT-FL${monthStr}-?(\\d+)$`, 'i'));
    if (matchFl && matchFl[1]) {
      const num = parseInt(matchFl[1], 10);
      if (num > maxSeq) maxSeq = num;
      return;
    }

    // Pattern 2: Existing sheet pattern TMT{year}-{month}-{seq} e.g. TMT2026-11-0012
    const matchTmt = val.match(new RegExp(`^TMT\\d{4}-${monthStr}-(\\d+)$`, 'i'));
    if (matchTmt && matchTmt[1]) {
      const num = parseInt(matchTmt[1], 10);
      if (num > maxSeq) maxSeq = num;
      return;
    }
  });

  const nextSeq = maxSeq + 1;
  const seqStr = String(nextSeq).padStart(4, '0');
  return `TMT-FL${monthStr}-${seqStr}`;
}

export const RepairRequestModal: React.FC<RepairRequestModalProps> = ({
  isOpen,
  onClose,
  existingRows,
  onSavedSuccess,
}) => {
  const [date, setDate] = useState<string>(getCurrentThaiDateString());
  const [time, setTime] = useState<string>(getCurrentTimeString());
  const [vehicleNumber, setVehicleNumber] = useState<string>('');
  const [repairType, setRepairType] = useState<string>('ซ่อมทั่วไป (MN)');
  const [symptoms, setSymptoms] = useState<string>('');
  const [reporterName, setReporterName] = useState<string>('');
  const [repairRequestNo, setRepairRequestNo] = useState<string>('');
  const [sparePartsCost, setSparePartsCost] = useState<string>('');
  const [laborCost, setLaborCost] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [photos, setPhotos] = useState<string[]>([]);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Extract reference vehicle list and reporters
  const referenceOptions = useMemo(() => {
    const vehicles = new Set<string>();
    const reporters = new Set<string>();
    const repairTypes = new Set<string>([
      'ซ่อมทั่วไป (MN)',
      'ซ่อมเชิงป้องกัน (PM)',
      'ยางเสื่อมสภาพ',
      'ยางรั่ว',
      'ระบบไฟรถ',
      'ระบบเบรค',
      'ระบบช่วงล่าง',
      'ระบบแบตเตอร์รี่',
      'ระบบไดสตาร์ท',
      'ระบบระบายความร้อน',
      'ระบบส่งกำลัง',
      'ระบบเชื้อเพลิง',
      'เครื่องยนต์',
      'ไฮดรอลิค',
      'โครงสร้าง',
      'อื่นๆ',
    ]);

    existingRows.forEach((r) => {
      const veh = (r.values['D'] ?? '').trim();
      const typ = (r.values['E'] ?? '').trim();
      const rep = (r.values['AA'] ?? '').trim();
      if (veh) vehicles.add(veh);
      if (typ) repairTypes.add(typ);
      if (rep) reporters.add(rep);
    });

    return {
      vehicles: Array.from(vehicles),
      reporters: Array.from(reporters),
      repairTypes: Array.from(repairTypes),
    };
  }, [existingRows]);

  useEffect(() => {
    if (isOpen) {
      setDate(getCurrentThaiDateString());
      setTime(getCurrentTimeString());
      setSubmitError(null);
      setRepairRequestNo(generateNextRepairRequestNo(existingRows));
    }
  }, [isOpen, existingRows]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const availableSlots = 9 - photos.length;
    if (availableSlots <= 0) return;

    const selectedFiles = Array.from(files).slice(0, availableSlots);
    const newCompressedPhotos: string[] = [];

    for (const file of selectedFiles) {
      try {
        const compressed = await compressImageFile(file);
        newCompressedPhotos.push(compressed);
      } catch {
        // ignore individual failed compression
      }
    }

    setPhotos((prev) => [...prev, ...newCompressedPhotos]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!vehicleNumber.trim()) {
      setSubmitError('กรุณาระบุเบอร์รถ');
      return;
    }
    if (!repairType.trim()) {
      setSubmitError('กรุณาเลือกประเภทการซ่อม');
      return;
    }
    if (!symptoms.trim()) {
      setSubmitError('กรุณาระบุอาการเสียหรือสิ่งที่ต้องการซ่อม');
      return;
    }
    if (!reporterName.trim()) {
      setSubmitError('กรุณาระบุชื่อผู้แจ้งซ่อม');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: RepairRequestPayload = {
        date: date.trim(),
        time: time.trim() || getCurrentTimeString(),
        vehicleNumber: vehicleNumber.trim(),
        repairType: repairType.trim(),
        symptoms: symptoms.trim(),
        reporterName: reporterName.trim(),
        repairRequestNo: repairRequestNo.trim(),
        sparePartsCost: sparePartsCost.trim(),
        laborCost: laborCost.trim(),
        note: note.trim(),
        photos: photos.length > 0 ? photos : undefined,
      };

      await appendRepairRecord(payload);

      showSuccessToast(
        'บันทึกแจ้งซ่อมสำเร็จ!',
        'ระบบบันทึกรายการแจ้งซ่อมลงฐานข้อมูลเรียบร้อยแล้ว'
      );

      // Reset form
      setSymptoms('');
      setSparePartsCost('');
      setLaborCost('');
      setNote('');
      setRepairRequestNo('');
      setPhotos([]);

      onSavedSuccess();
      onClose();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกแจ้งซ่อม'
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
        className="flex max-h-[94vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 sm:px-5 sm:py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Wrench className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 sm:text-base">
              บันทึกแจ้งซ่อม
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="ปิดหน้าต่าง"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error Banner */}
        {submitError && (
          <div className="mx-4 mt-2.5 sm:mx-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
            {/* วันที่แจ้ง */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                วันที่แจ้ง <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="5/11/2569"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* เวลาแจ้ง */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                เวลาแจ้ง
              </label>
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="09:30:00"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* เบอร์รถ */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                เบอร์รถ <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                list="repair-vehicles"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="FL-10, TT-20"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <datalist id="repair-vehicles">
                {referenceOptions.vehicles.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>

            {/* ประเภทการซ่อม */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ประเภทการซ่อม <span className="text-red-600">*</span>
              </label>
              <select
                required
                value={repairType}
                onChange={(e) => setRepairType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {referenceOptions.repairTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* ผู้แจ้งซ่อม */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ผู้แจ้งซ่อม <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                list="repair-reporters"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                placeholder="ชื่อ-นามสกุล ผู้แจ้ง"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <datalist id="repair-reporters">
                {referenceOptions.reporters.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>

            {/* เลขที่ขอซ่อม (รันอัตโนมัติ) */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                  เลขที่ขอซ่อม
                </label>
                <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded">
                  รันอัตโนมัติ
                </span>
              </div>
              <input
                type="text"
                value={repairRequestNo}
                onChange={(e) => setRepairRequestNo(e.target.value)}
                placeholder="TMT-FL11-0013"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs sm:text-sm font-semibold text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
              />
            </div>

            {/* ค่าอะไหล่ */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ค่าอะไหล่ (บาท)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={sparePartsCost}
                onChange={(e) => setSparePartsCost(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* ค่าแรง */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ค่าแรง (บาท)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={laborCost}
                onChange={(e) => setLaborCost(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* อาการ / ปัญหาที่พบ */}
            <div className="col-span-2">
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                อาการ / รายละเอียดที่ต้องการซ่อม <span className="text-red-600">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="ระบุอาการเสีย หรือสาเหตุที่ต้องการซ่อมอย่างละเอียด..."
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* แนบรูปถ่ายแจ้งซ่อม */}
            <div className="col-span-2">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                  แนบรูปถ่ายประกอบการแจ้งซ่อม (สูงสุด 9 รูป)
                </label>
                <span className="font-mono text-[11px] text-slate-400">
                  {photos.length}/9 รูป
                </span>
              </div>

              {/* Upload trigger buttons */}
              {photos.length < 9 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                    id="repair-photo-upload"
                  />
                  <label
                    htmlFor="repair-photo-upload"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-900 hover:bg-slate-100"
                  >
                    <Camera className="h-4 w-4 text-slate-600" />
                    <span>ถ่ายรูป / เลือกรูปภาพ</span>
                  </label>
                  <span className="text-[11px] text-slate-400">
                    รองรับภาพถ่ายจากมือถือและกล้อง
                  </span>
                </div>
              )}

              {/* Image Previews */}
              {photos.length > 0 && (
                <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((src, idx) => (
                    <div
                      key={idx}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-xs"
                    >
                      <img
                        src={src}
                        alt={`รูปถ่ายที่ ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute top-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-bold text-white">
                        รูปที่ {idx + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(idx)}
                        aria-label={`ลบรูปที่ ${idx + 1}`}
                        className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow-xs transition-opacity hover:bg-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* หมายเหตุ */}
            <div className="col-span-2">
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                หมายเหตุเพิ่มเติม
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isSubmitting ? 'กำลังบันทึก...' : 'บันทึกแจ้งซ่อม'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
