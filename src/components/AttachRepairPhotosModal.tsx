import React, { useState, useEffect, useRef } from 'react';
import { X, Camera, Upload, Trash2, Check, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { SheetRow } from '../types';
import { updateRepairPhotos, isPhotoValue } from '../services/googleSheets';
import { DrivePhotoImg } from './DrivePhotoImg';
import { showSuccessToast } from '../utils/swal';

interface AttachRepairPhotosModalProps {
  isOpen: boolean;
  onClose: () => void;
  row: SheetRow | null;
  onPhotosUpdated: (updatedPhotos: string[]) => void;
}

const PHOTO_COLS = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];

function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('รูปภาพไม่ถูกต้อง'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_CHARS = 45000;
        let maxDim = 800;
        let quality = 0.65;
        let compressedDataUrl = '';

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
          compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

          if (compressedDataUrl.length <= MAX_CHARS) {
            break;
          }
          maxDim = Math.round(maxDim * 0.78);
          quality = Math.max(0.45, quality - 0.08);
        }

        resolve(compressedDataUrl);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function recompressDataUrlIfOversized(src: string): Promise<string> {
  const trimmed = (src || '').trim();
  if (!trimmed.startsWith('data:image/') || trimmed.length <= 45000) {
    return Promise.resolve(trimmed);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(trimmed);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_CHARS = 45000;
      let maxDim = 800;
      let quality = 0.65;
      let compressedDataUrl = trimmed;

      while (maxDim >= 280) {
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
          resolve(trimmed);
          return;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

        if (compressedDataUrl.length <= MAX_CHARS) {
          break;
        }
        maxDim = Math.round(maxDim * 0.78);
        quality = Math.max(0.42, quality - 0.08);
      }

      resolve(compressedDataUrl);
    };
    img.src = trimmed;
  });
}

export const AttachRepairPhotosModal: React.FC<AttachRepairPhotosModalProps> = ({
  isOpen,
  onClose,
  row,
  onPhotosUpdated,
}) => {
  const [photos, setPhotos] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (row && isOpen) {
      const extracted: string[] = [];
      PHOTO_COLS.forEach((col) => {
        const val = (row.values[col] || '').trim();
        if (isPhotoValue(val)) {
          extracted.push(val);
        }
      });
      setPhotos(extracted);
      setError(null);
      setPreviewPhoto(null);
    }
  }, [row, isOpen]);

  if (!isOpen || !row) return null;

  const sequenceNo = (row.values['A'] || String(row.rowNumber)).trim();
  const repairRequestNo = (row.values['G'] || '').trim();
  const vehicleNumber = (row.values['D'] || '').trim();
  const repairType = (row.values['E'] || '').trim();
  const symptoms = (row.values['F'] || '').trim();

  const handleProcessFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const availableSlots = 9 - photos.length;
    if (availableSlots <= 0) {
      setError('แนบรูปถ่ายครบ 9 รูปแล้ว ไม่สามารถเพิ่มรูปได้อีก');
      return;
    }

    const filesToProcess = Array.from(files).slice(0, availableSlots);
    setError(null);

    try {
      const compressedList = await Promise.all(
        filesToProcess.map((file) => compressImageFile(file))
      );
      setPhotos((prev) => [...prev, ...compressedList]);
    } catch {
      setError('เกิดข้อผิดพลาดในการประมวลผลรูปภาพ');
    }
  };

  const handleRemovePhoto = (indexToRemove: number) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const cleanedPhotos = await Promise.all(
        photos.slice(0, 9).map((p) => recompressDataUrlIfOversized(p))
      );
      const paddedPhotos = Array.from({ length: 9 }, (_, idx) =>
        (cleanedPhotos[idx] || '').trim()
      );

      await updateRepairPhotos({
        rowNumber: row.rowNumber,
        sequenceNo,
        repairRequestNo,
        photos: paddedPhotos,
      });

      // Update row.values directly for immediate responsiveness across all 9 photo columns
      PHOTO_COLS.forEach((col, idx) => {
        row.values[col] = paddedPhotos[idx] || '';
      });

      showSuccessToast(
        'บันทึกรูปถ่ายสำเร็จ!',
        'ระบบอัปเดตรูปถ่ายในฐานข้อมูลเรียบร้อยแล้ว'
      );

      onPhotosUpdated(paddedPhotos);
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการบันทึกรูปถ่ายลงแถวเดิม'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-xs"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Camera className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 sm:text-base truncate">
                แนบรูปเพิ่ม / แก้ไขรูปถ่าย
              </h2>
              <p className="text-xs text-slate-500 truncate">
                รายการ #{sequenceNo} {repairRequestNo ? `• ${repairRequestNo}` : ''} • รถ {vehicleNumber || '-'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="ปิดหน้าต่าง"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Quick Info Summary */}
          <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs sm:text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-500">ประเภทงานซ่อม:</span>{' '}
                <span className="font-semibold text-slate-900">{repairType || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">เลขที่ขอซ่อม:</span>{' '}
                <span className="font-mono font-bold text-slate-900">{repairRequestNo || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500">อาการเสีย:</span>{' '}
                <span className="font-medium text-slate-800">{symptoms || '-'}</span>
              </div>
            </div>
          </div>

          {/* Photos Status & Upload Controls */}
          <div>
            <div className="flex items-center justify-between pb-2">
              <label className="text-xs font-bold text-slate-900">
                รูปถ่ายแจ้งซ่อม (ทั้งหมด 9 ช่อง)
              </label>
              <span className="font-mono text-xs font-semibold text-slate-600">
                {photos.length}/9 รูป
              </span>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                handleProcessFiles(e.target.files);
                if (e.target) e.target.value = '';
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleProcessFiles(e.target.files);
                if (e.target) e.target.value = '';
              }}
            />

            {/* Upload Action Buttons */}
            {photos.length < 9 && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 hover:border-slate-400 transition-colors"
                >
                  <Camera className="h-4 w-4 text-slate-600" />
                  <span>ถ่ายรูปจากกล้อง</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 hover:border-slate-400 transition-colors"
                >
                  <Upload className="h-4 w-4 text-slate-600" />
                  <span>เลือกรูปจากเครื่อง</span>
                </button>
              </div>
            )}

            {/* Photos Grid */}
            {photos.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
                {photos.map((src, idx) => (
                  <div
                    key={idx}
                    className="group relative flex flex-col items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-2xs"
                  >
                    <DrivePhotoImg
                      src={src}
                      alt={`รูปที่ ${idx + 1}`}
                      onClick={() => setPreviewPhoto(src)}
                      className="h-28 w-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
                    />
                    <div className="absolute top-1 left-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      รูปที่ {idx + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(idx)}
                      disabled={isSubmitting}
                      title="ลบรูปนี้"
                      className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow-xs hover:bg-red-700"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 border-dashed p-6 text-center text-slate-500">
                <ImageIcon className="mx-auto h-8 w-8 text-slate-300" />
                <div className="mt-1 text-xs font-medium text-slate-700">
                  ยังไม่มีรูปถ่ายแนบในรายการนี้
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  กดปุ่มถ่ายรูปหรือเลือกไฟล์รูปภาพด้านบนเพื่อแนบรูปภาพเพิ่มเติม
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 sm:px-6 bg-slate-50/50">
          <div className="text-[11px] text-slate-500">
            อัปเดตข้อมูลที่แถวเดิม #{row.rowNumber}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{isSubmitting ? 'กำลังบันทึกลงแถวเดิม...' : 'บันทึกรูปถ่าย'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Enlarged Photo Preview Modal */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <DrivePhotoImg
              src={previewPhoto}
              alt="ดูรูปภาพขนาดเต็ม"
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setPreviewPhoto(null)}
              className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
