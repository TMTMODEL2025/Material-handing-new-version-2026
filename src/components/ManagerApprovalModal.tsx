import React, { useState, useMemo, useEffect } from 'react';
import { X, CheckCircle2, XCircle, Clock, AlertCircle, HelpCircle, Lock } from 'lucide-react';
import { SheetRow, RepairApprovalPayload } from '../types';
import { approveRepairRecord, updateRepairAdditionalDetails, isPhotoValue } from '../services/googleSheets';
import { DrivePhotoImg } from './DrivePhotoImg';
import { showSuccessToast } from '../utils/swal';

const PHOTO_COLS = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];

const MANAGER_ACCESS_PIN = '685400';

interface ManagerApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: SheetRow[];
  onApprovedSuccess: () => void;
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

export const ManagerApprovalModal: React.FC<ManagerApprovalModalProps> = ({
  isOpen,
  onClose,
  rows,
  onApprovedSuccess,
}) => {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);

  const [filterMode, setFilterMode] = useState<'PENDING' | 'ALL'>('PENDING');
  const DEFAULT_APPROVER_NAME = 'นายกฤษฎา เกิดเสม';

  const [approverName, setApproverName] = useState<string>(
    () => localStorage.getItem('gsheets_manager_approver_name') || DEFAULT_APPROVER_NAME
  );
  const [selectedRow, setSelectedRow] = useState<SheetRow | null>(null);
  const [decision, setDecision] = useState<'3.✔️อนุมัติ' | '1.❌ไม่อนุมัติ' | '4.⚠️ขอข้อมูลเพิ่มเติม'>('3.✔️อนุมัติ');
  const [note, setNote] = useState<string>('');
  const [additionalInfo, setAdditionalInfo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsUnlocked(false);
      setPinInput('');
      setPinError(null);
      setSelectedRow(null);
      setError(null);
      setPreviewPhoto(null);
    }
  }, [isOpen]);

  // Filter rows based on approval status (exclude 'รอตรวจสอบ' until passed 'ผู้ตรวจสอบ')
  const pendingRows = useMemo(() => {
    return rows.filter((r) => {
      const status = (r.values['AI'] ?? '').trim();
      const repairStatus = (r.values['P'] ?? '').trim();
      const inspector = (r.values['AB'] ?? '').trim();
      const replyText = (r.values['AM'] ?? '').trim();
      if (
        status === 'รอตรวจสอบ' ||
        repairStatus === 'รอตรวจสอบ' ||
        (!status && !inspector)
      ) {
        return false;
      }
      return (
        status === '2.⚠️รออนุมัติ' ||
        status === 'รออนุมัติ' ||
        status === '2.⚠️รอพิจารณา' ||
        status === 'รอพิจารณา' ||
        status === '4.⚠️ขอข้อมูลเพิ่มเติม' ||
        status === '4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว' ||
        status.includes('ขอข้อมูล') ||
        status.includes('ตอบกลับ') ||
        status.includes('รอ') ||
        Boolean(replyText) ||
        !status
      );
    });
  }, [rows]);

  const displayedRows = filterMode === 'PENDING' ? pendingRows : rows;

  if (!isOpen) return null;

  const handleVerifyPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() === MANAGER_ACCESS_PIN) {
      setIsUnlocked(true);
      setPinError(null);
    } else {
      setPinError('รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    }
  };

  if (!isUnlocked) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        onClick={onClose}
      >
        <div
          className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white">
                <Lock className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  ยืนยันสิทธิ์ผู้จัดการ
                </h2>
                <p className="text-xs text-slate-500">
                  เมนูผู้จัดการอนุมัติงานซ่อม
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleVerifyPin} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                กรุณากรอกรหัสผ่านเข้าใช้งาน
              </label>
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  if (pinError) setPinError(null);
                }}
                placeholder="รหัสผ่าน 6 หลัก"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-center font-mono text-base tracking-widest text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none"
              />
            </div>

            {pinError && (
              <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{pinError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-800"
              >
                เข้าสู่เมนูอนุมัติ
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }


  const handleOpenDecision = (
    row: SheetRow,
    defaultDecision: '3.✔️อนุมัติ' | '1.❌ไม่อนุมัติ' | '4.⚠️ขอข้อมูลเพิ่มเติม'
  ) => {
    setSelectedRow(row);
    setDecision(defaultDecision);
    setNote('');
    setAdditionalInfo((row.values['AK'] ?? '').trim());
    setError(null);
  };

  const handleConfirmDecision = async () => {
    if (!selectedRow) return;
    if (!approverName.trim()) {
      setError('กรุณาระบุชื่อผู้อนุมัติ');
      return;
    }

    if (decision === '4.⚠️ขอข้อมูลเพิ่มเติม' && !additionalInfo.trim() && !note.trim()) {
      setError('กรุณาระบุรายละเอียดหรือข้อมูลที่ต้องการขอเพิ่มเติม');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const repairStatus =
        decision === '3.✔️อนุมัติ'
          ? 'รอคิวซ่อม'
          : decision === '1.❌ไม่อนุมัติ'
          ? 'ยกเลิกการซ่อม'
          : 'รอข้อมูลเพิ่มเติม';

      const finalNote =
        decision === '4.⚠️ขอข้อมูลเพิ่มเติม'
          ? additionalInfo.trim() || note.trim()
          : note.trim();

      const payload: RepairApprovalPayload = {
        rowNumber: selectedRow.rowNumber,
        sequenceNo: (selectedRow.values['A'] ?? '').trim(),
        approvalStatus: decision,
        approverName: approverName.trim(),
        approvalDate: getCurrentThaiDateString(),
        approvalTime: getCurrentTimeString(),
        repairStatus,
        note: finalNote,
      };

      await approveRepairRecord(payload);

      if (decision === '4.⚠️ขอข้อมูลเพิ่มเติม' && additionalInfo.trim()) {
        try {
          await updateRepairAdditionalDetails({
            rowNumber: selectedRow.rowNumber,
            sequenceNo: (selectedRow.values['A'] ?? '').trim(),
            repairRequestNo: (selectedRow.values['G'] ?? '').trim(),
            additionalDetails: additionalInfo.trim(),
          });
          selectedRow.values['AK'] = additionalInfo.trim();
        } catch {
          // ignore
        }
      }

      const toastTitle =
        decision === '3.✔️อนุมัติ'
          ? 'บันทึกการอนุมัติสำเร็จ!'
          : decision === '4.⚠️ขอข้อมูลเพิ่มเติม'
          ? 'ส่งคำขอข้อมูลเพิ่มเติมสำเร็จ!'
          : 'บันทึกการไม่อนุมัติสำเร็จ!';

      showSuccessToast(toastTitle, 'ระบบบันทึกผลการพิจารณาเรียบร้อยแล้ว');

      setSelectedRow(null);
      onApprovedSuccess();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกการอนุมัติ'
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
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 sm:text-base">
                เมนูผู้จัดการอนุมัติงานซ่อม
              </h2>
              <div className="text-xs text-slate-500">
                รายการรอพิจารณาอนุมัติ{' '}
                <strong className="font-mono text-emerald-700">
                  {pendingRows.length.toLocaleString('th-TH')}
                </strong>{' '}
                รายการ
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="ปิดหน้าต่าง"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Top Controls: Approver name & filter tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-700">
              ชื่อผู้อนุมัติ:
            </label>
            <input
              type="text"
              value={approverName}
              onChange={(e) => {
                setApproverName(e.target.value);
                try {
                  localStorage.setItem('gsheets_manager_approver_name', e.target.value);
                } catch {
                  // ignore storage error
                }
              }}
              placeholder="ระบุชื่อผู้จัดการอนุมัติ"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilterMode('PENDING')}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                filterMode === 'PENDING'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              รอพิจารณา ({pendingRows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                filterMode === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              ทั้งหมดในตาราง ({rows.length})
            </button>
          </div>
        </div>

        {/* Content list / Decision view */}
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
          {selectedRow ? (
            /* Confirmation card */
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  ยืนยันการอนุมัติรายการ #{selectedRow.values['A'] || selectedRow.rowNumber}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRow(null)}
                  className="text-xs text-slate-500 hover:underline"
                >
                  ย้อนกลับ
                </button>
              </div>

              {error && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:text-sm">
                <div>
                  <span className="text-slate-500">วันที่แจ้ง:</span>{' '}
                  <span className="font-semibold text-slate-900">
                    {selectedRow.values['B']} {selectedRow.values['C']}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">เบอร์รถ:</span>{' '}
                  <span className="font-mono font-bold text-slate-900">
                    {selectedRow.values['D']}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">ประเภทการซ่อม:</span>{' '}
                  <span className="font-semibold text-slate-900">
                    {selectedRow.values['E']}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">ผู้แจ้ง:</span>{' '}
                  <span className="font-semibold text-slate-900">
                    {selectedRow.values['AA']}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">อาการเสีย:</span>
                  <div className="mt-0.5 whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs text-slate-800">
                    {selectedRow.values['F'] || '-'}
                  </div>
                </div>
                {(() => {
                  const rowPhotos = PHOTO_COLS.map((c) => (selectedRow.values[c] ?? '').trim())
                    .filter((v) => isPhotoValue(v))
                    .sort((a, b) => {
                      const aDirect = a.startsWith('data:image/') || a.startsWith('http') ? 0 : 1;
                      const bDirect = b.startsWith('data:image/') || b.startsWith('http') ? 0 : 1;
                      return aDirect - bDirect;
                    });
                  if (rowPhotos.length === 0) return null;
                  return (
                    <div className="col-span-2">
                      <span className="text-slate-500">รูปถ่ายประกอบการซ่อม ({rowPhotos.length} รูป):</span>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {rowPhotos.map((pSrc, idx) => (
                          <DrivePhotoImg
                            key={idx}
                            src={pSrc}
                            alt={`รูปถ่ายที่ ${idx + 1}`}
                            onClick={() => setPreviewPhoto(pSrc)}
                            className="h-20 w-28 cursor-pointer rounded-lg border border-slate-200 object-cover shadow-2xs transition-opacity hover:opacity-90"
                          />
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {selectedRow.values['AK'] && (
                  <div className="col-span-2">
                    <span className="text-slate-500 font-medium">คำขอข้อมูลเพิ่มเติมจากผู้อนุมัติ:</span>
                    <div className="mt-0.5 whitespace-pre-wrap rounded border border-amber-200 bg-amber-50/70 p-2 text-xs text-amber-900">
                      {selectedRow.values['AK']}
                    </div>
                  </div>
                )}
                {selectedRow.values['AM'] && (
                  <div className="col-span-2">
                    <span className="text-emerald-800 font-bold flex items-center gap-1">
                      <span>💬</span> ข้อความตอบกลับข้อมูลเพิ่มเติมจากผู้แจ้งซ่อม:
                    </span>
                    <div className="mt-0.5 whitespace-pre-wrap rounded border border-emerald-300 bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-950 shadow-2xs">
                      {selectedRow.values['AM']}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-slate-200 pt-3">
                <label className="block text-xs font-semibold text-slate-800">
                  ผลการพิจารณา:
                </label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDecision('3.✔️อนุมัติ')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      decision === '3.✔️อนุมัติ'
                        ? 'bg-emerald-700 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>3.✔️ อนุมัติ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDecision('4.⚠️ขอข้อมูลเพิ่มเติม')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      decision === '4.⚠️ขอข้อมูลเพิ่มเติม'
                        ? 'bg-amber-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span>4.⚠️ ขอข้อมูลเพิ่มเติม</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDecision('1.❌ไม่อนุมัติ')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      decision === '1.❌ไม่อนุมัติ'
                        ? 'bg-red-700 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>1.❌ ไม่อนุมัติ</span>
                  </button>
                </div>

                {decision === '4.⚠️ขอข้อมูลเพิ่มเติม' ? (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <label className="block text-xs font-bold text-amber-900">
                      รายละเอียดข้อมูลที่ขอเพิ่มเติม <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      rows={2}
                      value={additionalInfo}
                      onChange={(e) => setAdditionalInfo(e.target.value)}
                      placeholder="ระบุรายละเอียดหรือข้อมูลเพิ่มเติมที่ต้องการให้ผู้แจ้งซ่อมชี้แจง..."
                      className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-700">
                      หมายเหตุผู้อนุมัติ:
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setSelectedRow(null)}
                  disabled={isSubmitting}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDecision}
                  disabled={isSubmitting}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white transition-colors ${
                    decision === '3.✔️อนุมัติ'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : decision === '4.⚠️ขอข้อมูลเพิ่มเติม'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-red-700 hover:bg-red-800'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>
                    {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกผลการพิจารณา'}
                  </span>
                </button>
              </div>
            </div>
          ) : displayedRows.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <Clock className="mx-auto h-8 w-8 text-slate-300" />
              <div className="mt-2 text-sm font-semibold text-slate-800">
                ไม่มีรายการข้อมูล
              </div>
              <div className="text-xs text-slate-400">
                {filterMode === 'PENDING'
                  ? 'ไม่พบรายการรอการอนุมัติในระบบ'
                  : 'ไม่พบรายการข้อมูลในตาราง'}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {displayedRows.map((r) => {
                const seq = r.values['A'] || `#${r.rowNumber}`;
                const dt = r.values['B'] || '';
                const veh = r.values['D'] || '';
                const typ = r.values['E'] || '';
                const sym = r.values['F'] || '';
                const rep = r.values['AA'] || '';
                const appStatus = (r.values['AI'] ?? '').trim();
                const repairStatus = (r.values['P'] ?? '').trim();
                const inspector = (r.values['AB'] ?? '').trim();
                const approver = r.values['AE'] || '';
                const reqInfoText = (r.values['AK'] ?? '').trim();
                const replyText = (r.values['AM'] ?? '').trim();

                const isWaitingInspection =
                  appStatus === 'รอตรวจสอบ' ||
                  repairStatus === 'รอตรวจสอบ' ||
                  (!appStatus && !inspector);
                const isReplied = appStatus.includes('ตอบกลับ') || Boolean(replyText);
                const isApproved =
                  appStatus.includes('อนุมัติ') &&
                  !appStatus.includes('ไม่อนุมัติ') &&
                  !appStatus.includes('รอ') &&
                  !isReplied;
                const isRejected = appStatus.includes('ไม่อนุมัติ');
                const isNeedInfo =
                  (appStatus.includes('ขอข้อมูล') || Boolean(reqInfoText)) && !isReplied;

                const displayStatusLabel = isWaitingInspection
                  ? 'รอตรวจสอบ'
                  : isReplied
                  ? '4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว'
                  : appStatus === '2.⚠️รอพิจารณา' || appStatus === 'รอพิจารณา' || !appStatus
                  ? '2.⚠️รออนุมัติ'
                  : appStatus;

                return (
                  <div
                    key={r.rowNumber}
                    className="flex flex-col gap-2 py-3.5 border-b border-slate-100 last:border-0 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900">
                          ลำดับ {seq}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                          {veh}
                        </span>
                        <span className="text-xs text-slate-500">{dt}</span>
                        {displayStatusLabel && (
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              isWaitingInspection
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : isReplied
                                ? 'bg-emerald-100 text-emerald-950 border border-emerald-400 shadow-2xs'
                                : isApproved
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : isRejected
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : isNeedInfo
                                ? 'bg-amber-50 text-amber-800 border border-amber-300'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {displayStatusLabel}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-700">
                        <strong className="font-medium text-slate-900">{typ}:</strong>{' '}
                        <span className="text-slate-600 line-clamp-1">{sym || '-'}</span>
                      </div>

                      {reqInfoText && (
                        <div className="mt-1 text-xs text-amber-900 bg-amber-50/80 p-1.5 rounded border border-amber-200">
                          <strong className="font-semibold text-amber-950">คำขอข้อมูลเพิ่ม:</strong> {reqInfoText}
                        </div>
                      )}

                      {replyText && (
                        <div className="mt-1.5 rounded-lg border border-emerald-300 bg-emerald-50/90 p-2 text-xs text-emerald-950 shadow-2xs">
                          <div className="font-bold text-emerald-900 flex items-center gap-1 mb-0.5">
                            <span className="text-sm">💬</span>
                            <span>ประวัติ / ข้อความตอบกลับข้อมูลเพิ่มเติม:</span>
                          </div>
                          <div className="whitespace-pre-wrap font-semibold text-emerald-950 bg-white/90 p-2 rounded border border-emerald-200/80">
                            {replyText}
                          </div>
                        </div>
                      )}

                      <div className="mt-1 text-[11px] text-slate-400">
                        ผู้แจ้ง: {rep || '-'} {inspector ? `· ผู้ตรวจสอบ: ${inspector}` : ''} {approver ? `· ผู้อนุมัติ: ${approver}` : ''}
                      </div>

                      {(() => {
                        const itemPhotos = PHOTO_COLS.map((c) => (r.values[c] ?? '').trim())
                          .filter((v) => isPhotoValue(v))
                          .sort((a, b) => {
                            const aDirect = a.startsWith('data:image/') || a.startsWith('http') ? 0 : 1;
                            const bDirect = b.startsWith('data:image/') || b.startsWith('http') ? 0 : 1;
                            return aDirect - bDirect;
                          });
                        if (itemPhotos.length === 0) return null;
                        return (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {itemPhotos.map((pSrc, pIdx) => (
                              <DrivePhotoImg
                                key={pIdx}
                                src={pSrc}
                                alt={`รูปงานซ่อม ${pIdx + 1}`}
                                onClick={() => setPreviewPhoto(pSrc)}
                                className="h-12 w-16 cursor-pointer rounded-md border border-slate-200 object-cover shadow-2xs transition-opacity hover:opacity-90"
                              />
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 sm:self-center">
                      <button
                        type="button"
                        onClick={() => handleOpenDecision(r, '3.✔️อนุมัติ')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>อนุมัติ</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenDecision(r, '4.⚠️ขอข้อมูลเพิ่มเติม')}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                        <span>ขอข้อมูลเพิ่ม</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenDecision(r, '1.❌ไม่อนุมัติ')}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>ไม่อนุมัติ</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
