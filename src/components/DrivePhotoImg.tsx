import React, { useState, useEffect } from 'react';
import { Image as ImageIcon, RefreshCw, Truck, User } from 'lucide-react';
import {
  clearFailedDriveImageCache,
  extractDriveFileId,
  formatDriveImageUrl,
  getDriveThumbnailUrl,
  isLegacyAppSheetPhotoPath,
  resolveDriveImageSrc,
} from '../services/googleSheets';

interface DrivePhotoImgProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
}

export const DrivePhotoImg: React.FC<DrivePhotoImgProps> = ({
  src,
  alt,
  className = '',
  onClick,
}) => {
  const trimmed = (src || '').trim();
  const isLegacyPath = isLegacyAppSheetPhotoPath(trimmed);
  const initialFormatted = formatDriveImageUrl(trimmed);
  const needsAsyncResolve = isLegacyPath && initialFormatted === trimmed;

  const [resolvedSrc, setResolvedSrc] = useState<string | null>(
    needsAsyncResolve ? null : initialFormatted
  );
  const [isLoading, setIsLoading] = useState<boolean>(needsAsyncResolve);
  const [hasError, setHasError] = useState<boolean>(false);
  const [triedAppsScriptFallback, setTriedAppsScriptFallback] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);

  const isCompactThumbnail =
    /\bh-(7|8|9|10|11|12)\b/.test(className) || /\bw-(9|10|12|14|16)\b/.test(className);

  useEffect(() => {
    let cancelled = false;
    setHasError(false);
    setTriedAppsScriptFallback(false);

    const formatted = formatDriveImageUrl(trimmed);
    const legacy = isLegacyAppSheetPhotoPath(trimmed);
    if (!legacy || formatted !== trimmed) {
      setResolvedSrc(formatted);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void resolveDriveImageSrc(trimmed, retryCount > 0).then((result) => {
      if (cancelled) return;
      if (result) {
        setResolvedSrc(result);
        setHasError(false);
      } else {
        setResolvedSrc(null);
        setHasError(true);
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [trimmed, retryCount]);

  if (isLoading) {
    if (isCompactThumbnail) {
      return (
        <div
          className={`inline-flex items-center justify-center rounded border border-slate-200 bg-slate-100 text-slate-400 animate-pulse ${className}`}
          title={`กำลังโหลดรูปภาพ: ${trimmed}`}
        >
          <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
        </div>
      );
    }
    return (
      <div
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-medium text-slate-500 animate-pulse ${className}`}
      >
        <ImageIcon className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="truncate">กำลังดึงรูปจาก Google Drive...</span>
      </div>
    );
  }

  if (hasError || !resolvedSrc) {
    const shortName = trimmed.includes('/')
      ? trimmed.split('/').pop()
      : trimmed;
    const folderPrefix = trimmed.includes('/') ? trimmed.split('/')[0] : '';
    const isAccountPhoto =
      folderPrefix.includes('Account') || alt.includes('พนักงาน');
    const isVehiclePhoto =
      folderPrefix.includes('ฐานข้อมูลรถ') || alt.includes('รถ');

    const PlaceholderIcon = isAccountPhoto
      ? User
      : isVehiclePhoto
      ? Truck
      : ImageIcon;

    if (isCompactThumbnail) {
      return (
        <div
          onClick={onClick}
          className={`inline-flex flex-col items-center justify-center rounded border border-slate-200/90 bg-slate-100/90 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-200/70 ${
            onClick ? 'cursor-pointer' : ''
          } ${className}`}
          title={`รูปจาก AppSheet (${trimmed}) — คลิกเพื่อดูรายละเอียดหรืออัปเดตรูปภาพ`}
        >
          <PlaceholderIcon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span className="text-[8px] font-semibold leading-none text-slate-500 mt-0.5 truncate max-w-full px-0.5">
            {isAccountPhoto ? 'พนักงาน' : isVehiclePhoto ? 'รูปรถ' : 'AppSheet'}
          </span>
        </div>
      );
    }

    return (
      <div
        onClick={onClick}
        className={`inline-flex flex-col items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50/90 p-2.5 text-left text-xs text-slate-600 shadow-2xs ${
          onClick ? 'cursor-pointer hover:border-slate-300' : ''
        }`}
        title={trimmed}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200/80 text-slate-600">
            <PlaceholderIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-slate-700 truncate max-w-[220px]">
              {shortName || 'ไม่พบไฟล์รูปภาพ'}
            </div>
            {folderPrefix && (
              <div className="text-[10px] text-slate-400 truncate">
                โฟลเดอร์ AppSheet: {folderPrefix}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              clearFailedDriveImageCache();
              setRetryCount((c) => c + 1);
            }}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            <span>ลองดึงรูปจาก Drive อีกครั้ง</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onClick={onClick as React.MouseEventHandler<HTMLImageElement> | undefined}
      onError={(e) => {
        const fallback = getDriveThumbnailUrl(trimmed);
        if (
          fallback &&
          fallback !== trimmed &&
          e.currentTarget.src !== fallback
        ) {
          e.currentTarget.src = fallback;
          return;
        }
        if (!triedAppsScriptFallback && extractDriveFileId(trimmed)) {
          setTriedAppsScriptFallback(true);
          void resolveDriveImageSrc(trimmed, true).then((base64OrUrl) => {
            if (base64OrUrl && base64OrUrl !== resolvedSrc) {
              setResolvedSrc(base64OrUrl);
            } else {
              setHasError(true);
            }
          });
          return;
        }
        setHasError(true);
      }}
      className={className}
    />
  );
};
