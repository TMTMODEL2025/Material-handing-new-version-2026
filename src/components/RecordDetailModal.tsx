import React, { useState } from 'react';
import { X, Check, Camera, Pencil, Upload } from 'lucide-react';
import { SheetColumn, SheetRow } from '../types';
import { isPhotoValue } from '../services/googleSheets';
import { DrivePhotoImg } from './DrivePhotoImg';
import { showSuccessToast } from '../utils/swal';

function compressImageToDataUrl(file: File, maxDim = 800, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('รูปแบบไฟล์รูปภาพไม่ถูกต้อง'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

interface RecordDetailModalProps {
  row: SheetRow | null;
  columns: SheetColumn[];
  tabName: string;
  onClose: () => void;
  onOpenAttachPhotos?: (row: SheetRow) => void;
  onUpdateAdditionalDetails?: (row: SheetRow, newDetails: string) => Promise<void>;
  onUpdateReplyDetails?: (row: SheetRow, newReply: string) => Promise<void>;
  onUpdateFinancialDetails?: (row: SheetRow, spareParts: string, labor: string) => Promise<void>;
  onUpdateVehicleField?: (row: SheetRow, colId: string, newValue: string) => Promise<string | void>;
  onInspectRepair?: (row: SheetRow, inspectorName: string) => Promise<void>;
}

export const RecordDetailModal: React.FC<RecordDetailModalProps> = ({
  row,
  columns,
  tabName,
  onClose,
  onOpenAttachPhotos,
  onUpdateAdditionalDetails,
  onUpdateReplyDetails,
  onUpdateFinancialDetails,
  onUpdateVehicleField,
  onInspectRepair,
}) => {
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessColId, setSaveSuccessColId] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [inspectorName, setInspectorName] = useState<string>(
    () => localStorage.getItem('gsheets_repair_inspector_name') || 'นายสุรสิทธิ์ นุชจันทร์'
  );
  const [isInspecting, setIsInspecting] = useState<boolean>(false);

  if (!row) return null;

  const isRepairTab = tabName.includes('ซ่อม');
  const isVehicleTab = tabName === 'ฐานข้อมูลรถ';

  const rowAppStatus = (row.values['AI'] ?? '').trim();
  const rowRepairStatus = (row.values['P'] ?? '').trim();
  const rowInspector = (row.values['AB'] ?? '').trim();
  const isWaitingInspection =
    isRepairTab &&
    (rowAppStatus === 'รอตรวจสอบ' ||
      rowRepairStatus === 'รอตรวจสอบ' ||
      (!rowAppStatus && !rowInspector));

  const handleConfirmInspection = async () => {
    if (!row || !onInspectRepair || !inspectorName.trim()) return;
    setIsInspecting(true);
    try {
      const cleanInspector = inspectorName.trim();
      try {
        localStorage.setItem('gsheets_repair_inspector_name', cleanInspector);
      } catch {
        // ignore
      }
      await onInspectRepair(row, cleanInspector);
      showSuccessToast(
        'ยืนยันการตรวจสอบสำเร็จ!',
        'ส่งข้อมูลไปยังสถานะ 2.⚠️รออนุมัติ เรียบร้อยแล้ว'
      );
    } catch {
      // ignore
    } finally {
      setIsInspecting(false);
    }
  };

  const startEditing = (colId: string, currentVal: string) => {
    setEditingColId(colId);
    setEditValue(currentVal === '-' ? '' : currentVal);
    setSaveSuccessColId(null);
  };

  const handleSaveField = async (colId: string) => {
    if (!row) return;
    setIsSaving(true);
    try {
      const cleanVal = editValue.trim();
      const targetCol = columns.find((c) => c.id === colId);

      if (isVehicleTab && onUpdateVehicleField) {
        const savedVal = await onUpdateVehicleField(row, colId, cleanVal);
        row.values[colId] = typeof savedVal === 'string' ? savedVal : cleanVal;
        setEditingColId(null);
        setSaveSuccessColId(colId);
        showSuccessToast(
          'บันทึกข้อมูลสำเร็จ!',
          `อัปเดต${targetCol?.label ? ` "${targetCol.label}"` : 'ข้อมูล'}เรียบร้อยแล้ว`
        );
        setTimeout(() => setSaveSuccessColId(null), 3000);
        return;
      }

      if (colId === 'AK' || colId.includes('รายละเอียดเพิ่มเติม')) {
        if (onUpdateAdditionalDetails) {
          await onUpdateAdditionalDetails(row, cleanVal);
        }
        row.values[colId] = cleanVal;
      } else if (colId === 'AM' || colId.includes('ตอบกลับ')) {
        if (onUpdateReplyDetails) {
          await onUpdateReplyDetails(row, cleanVal);
        }
        row.values[colId] = cleanVal;
      } else if (colId === 'N' || colId === 'O' || colId.includes('ค่าอะไหล่') || colId.includes('ค่าแรง')) {
        const spareParts = colId === 'N' || colId.includes('ค่าอะไหล่') ? cleanVal : (row.values['N'] ?? '');
        const labor = colId === 'O' || colId.includes('ค่าแรง') ? cleanVal : (row.values['O'] ?? '');
        if (onUpdateFinancialDetails) {
          await onUpdateFinancialDetails(row, spareParts, labor);
        }
        row.values['N'] = spareParts;
        row.values['O'] = labor;
      }

      setEditingColId(null);
      setSaveSuccessColId(colId);

      const isReply = colId === 'AM' || colId.includes('ตอบกลับ');
      const isFinancial = colId === 'N' || colId === 'O' || colId.includes('ค่าอะไหล่') || colId.includes('ค่าแรง');
      showSuccessToast(
        isFinancial ? 'บันทึกค่าใช้จ่ายสำเร็จ!' : isReply ? 'บันทึกการตอบกลับสำเร็จ!' : 'บันทึกรายละเอียดเพิ่มเติมสำเร็จ!',
        isFinancial
          ? 'อัปเดตค่าอะไหล่และค่าแรงเรียบร้อยแล้ว'
          : isReply
          ? 'ส่งข้อความตอบกลับและอัปเดตสถานะเรียบร้อยแล้ว'
          : 'ระบบบันทึกรายละเอียดเพิ่มเติมเรียบร้อยแล้ว'
      );

      setTimeout(() => setSaveSuccessColId(null), 3000);
    } catch {
      // ignore
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 sm:px-5 sm:py-3.5">
          <h2 className="text-sm font-bold text-slate-900 sm:text-base truncate">
            {tabName}{' '}
            <span className="font-mono text-xs font-normal text-slate-500 tabular-nums">
              #{row.rowNumber.toLocaleString('th-TH')}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-2.5 sm:px-5 sm:py-3.5">
          {isWaitingInspection && onInspectRepair && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50/80 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold text-amber-950">
                  ขั้นตอนผู้ตรวจสอบ (สถานะปัจจุบัน: รอตรวจสอบ)
                </div>
                <span className="rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                  รอตรวจสอบก่อนส่งอนุมัติ
                </span>
              </div>
              <div className="mt-2.5 space-y-2">
                <div>
                  <label className="block text-xs font-medium text-amber-900">
                    ชื่อผู้ตรวจสอบ:
                  </label>
                  <input
                    type="text"
                    value={inspectorName}
                    onChange={(e) => setInspectorName(e.target.value)}
                    placeholder="ระบุชื่อผู้ตรวจสอบ"
                    className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {['นายสุรสิทธิ์ นุชจันทร์', 'นายทศพล วิระพันธุ์'].map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setInspectorName(name)}
                        className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          inspectorName.trim() === name
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-amber-300 bg-white text-slate-700 hover:bg-amber-100'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isInspecting || !inspectorName.trim()}
                  onClick={handleConfirmInspection}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  <span>
                    {isInspecting
                      ? 'กำลังบันทึกการตรวจสอบ...'
                      : 'ยืนยันผ่านการตรวจสอบ (ส่งต่อไปยังสถานะ รออนุมัติ)'}
                  </span>
                </button>
              </div>
            </div>
          )}

          <div className="divide-y divide-slate-100">
            {columns.map((col) => {
              const rawVal = (row.values[col.id] || '').trim();
              const isPhotoColumn =
                col.label.includes('รูป') ||
                col.label.includes('ภาพ') ||
                (!isVehicleTab && ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'].includes(col.id));

              const hasValidPhoto = isPhotoValue(rawVal);

              // Hide photo fields if there is no attached photo (except on ฐานข้อมูลรถ where all fields are shown & editable)
              if (!isVehicleTab && isPhotoColumn && (!rawVal || rawVal === '-' || !hasValidPhoto)) {
                return null;
              }

              // Hide optional repair fields when they have no data (empty or '-')
              const isHideIfEmptyField =
                col.id === 'H' ||
                col.id === 'I' ||
                col.id === 'J' ||
                col.id === 'K' ||
                col.id === 'L' ||
                col.id === 'M' ||
                col.label.includes('SAP') ||
                col.label.includes('กำหนดการ') ||
                col.label.includes('ซ่อมเสร็จ') ||
                col.label.includes('ระยะเวลาซ่อม') ||
                col.label.includes('PR') ||
                col.label.includes('ใบกำกับภาษี');

              if (isRepairTab && isHideIfEmptyField && (!rawVal || rawVal === '-')) {
                return null;
              }

              let val = rawVal || '-';
              if (col.id === 'AI' || col.label.includes('สถานะการอนุมัติ')) {
                if (isWaitingInspection) {
                  val = 'รอตรวจสอบ';
                } else if (
                  !rawVal ||
                  rawVal === '-' ||
                  rawVal === '2.⚠️รอพิจารณา' ||
                  rawVal === 'รอพิจารณา'
                ) {
                  val = '2.⚠️รออนุมัติ';
                }
              }
              const isNumericOrDate =
                col.type === 'number' ||
                col.type === 'date' ||
                col.type === 'datetime' ||
                col.type === 'timeofday';

              const isEditableInModal =
                isVehicleTab ||
                (isRepairTab &&
                  (col.id === 'AK' ||
                    col.id === 'AM' ||
                    col.id === 'N' ||
                    col.id === 'O' ||
                    col.label.includes('รายละเอียดเพิ่มเติม') ||
                    col.label.includes('ตอบกลับข้อมูลเพิ่มเติม') ||
                    col.label.includes('ค่าอะไหล่') ||
                    col.label.includes('ค่าแรง')));

              if (isEditableInModal && editingColId === col.id) {
                return (
                  <div key={col.id} className="py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-700">
                        {col.label}
                      </span>
                      <span className="text-[11px] font-medium text-slate-400">
                        กำลังแก้ไข
                      </span>
                    </div>
                    {isVehicleTab && isPhotoColumn ? (
                      <div className="space-y-2">
                        {editValue && isPhotoValue(editValue) && (
                          <div className="flex justify-start">
                            <DrivePhotoImg
                              src={editValue}
                              alt={col.label}
                              className="h-24 w-24 rounded-lg border border-slate-200 object-cover"
                            />
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                            <Upload className="h-3.5 w-3.5 text-slate-600" />
                            <span>เลือกรูปภาพใหม่</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                try {
                                  const dataUrl = await compressImageToDataUrl(file);
                                  setEditValue(dataUrl);
                                } catch {
                                  // ignore
                                }
                              }}
                            />
                          </label>
                          {editValue && (
                            <button
                              type="button"
                              onClick={() => setEditValue('')}
                              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                            >
                              ลบรูปภาพ
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={editValue.startsWith('data:image/') ? '' : editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder="หรือวางลิงก์รูปภาพ (URL / Google Drive)..."
                          className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                        />
                      </div>
                    ) : !isVehicleTab &&
                      (col.id === 'N' ||
                        col.id === 'O' ||
                        col.label.includes('ค่าอะไหล่') ||
                        col.label.includes('ค่าแรง')) ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder={`พิมพ์${col.label}...`}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs sm:text-sm font-mono text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                      />
                    ) : isVehicleTab && col.id !== 'H' ? (
                      <input
                        type="text"
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleSaveField(col.id);
                          } else if (e.key === 'Escape') {
                            setEditingColId(null);
                          }
                        }}
                        placeholder={`พิมพ์${col.label}...`}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                      />
                    ) : (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        rows={3}
                        placeholder={`พิมพ์${col.label}...`}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs resize-y"
                      />
                    )}
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => setEditingColId(null)}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleSaveField(col.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{isSaving ? 'กำลังบันทึก...' : 'บันทึก'}</span>
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={col.id}
                  className="group flex items-baseline justify-between gap-3 py-2"
                >
                  <div className="shrink-0 text-xs font-medium text-slate-500">
                    {col.label}
                  </div>
                  <div className="flex min-w-0 flex-col items-end gap-1 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {hasValidPhoto && isPhotoColumn ? (
                        <div className="flex flex-col items-end gap-1">
                          <DrivePhotoImg
                            src={val}
                            alt={col.label}
                            onClick={() => setPreviewPhoto(val)}
                            className="max-h-36 max-w-xs cursor-pointer rounded-lg border border-slate-200 object-cover shadow-xs transition-opacity hover:opacity-95"
                          />
                        </div>
                      ) : (
                        <span
                          className={`break-words whitespace-pre-wrap text-xs sm:text-sm font-medium text-slate-900 ${
                            isNumericOrDate ? 'font-mono tabular-nums' : ''
                          }`}
                        >
                          {val}
                        </span>
                      )}

                      {isEditableInModal && (
                        <button
                          type="button"
                          onClick={() => startEditing(col.id, rawVal)}
                          title={`แก้ไข${col.label}`}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900 shadow-2xs shrink-0"
                        >
                          <Pencil className="h-2.5 w-2.5 text-slate-600" />
                          <span>แก้ไข</span>
                        </button>
                      )}
                    </div>

                    {saveSuccessColId === col.id && (
                      <span className="text-[11px] font-semibold text-emerald-600">
                        บันทึกข้อมูลเรียบร้อยแล้ว
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 sm:px-5">
          {isRepairTab && onOpenAttachPhotos ? (
            <button
              type="button"
              onClick={() => onOpenAttachPhotos(row)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Camera className="h-3.5 w-3.5" />
              <span>แนบรูปเพิ่ม / แก้ไขรูปถ่าย</span>
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            ปิด
          </button>
        </div>
      </div>

      {previewPhoto && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setPreviewPhoto(null);
          }}
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
              className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
