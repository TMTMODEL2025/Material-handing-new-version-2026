import React, { useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already installed or running as standalone, don't show prompt
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop install button
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-100 transition-colors shadow-2xs shrink-0"
        title="ติดตั้งแอปบนมือถือ/หน้าจอหลัก"
      >
        <Download className="h-3.5 w-3.5 text-indigo-700 shrink-0" />
        <span className="hidden sm:inline">ติดตั้งแอปบนมือถือ</span>
        <span className="sm:hidden">ติดตั้งแอป</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-100 transition-colors shadow-2xs shrink-0"
          title="วิธีติดตั้งบน iPhone/iPad"
        >
          <Smartphone className="h-3.5 w-3.5 text-indigo-700 shrink-0" />
          <span className="hidden sm:inline">วิธีติดตั้งบน iOS</span>
          <span className="sm:hidden">ติดแอป iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-indigo-600" />
                  วิธีติดตั้งแอปบน iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-4 space-y-3 text-xs text-slate-700 leading-relaxed">
                <p>
                  1. กดปุ่ม <strong>แชร์ (Share)</strong>
                  <span className="inline-block mx-1 px-1.5 py-0.5 rounded bg-slate-100 font-mono">
                    [↑]
                  </span>
                  บนแถบเมนูด้านล่างของ Safari
                </p>
                <p>
                  2. เลื่อนลงและเลือก <strong>"เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)</strong>
                </p>
                <p>
                  3. กด <strong>"เพิ่ม" (Add)</strong> มุมขวาบน เพื่อรับการแจ้งเตือนเสมือนแอปจริง
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm"
              >
                เข้าใจแล้ว
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
