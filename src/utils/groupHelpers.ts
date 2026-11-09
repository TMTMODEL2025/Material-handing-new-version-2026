export interface GroupHeaderTheme {
  rowClassName: string;
  accentBarClassName: string;
  chevronBtnClassName: string;
  iconBadgeClassName: string;
  titleClassName: string;
  countBadgeClassName: string;
  actionHintClassName: string;
  iconType: 'in_transit' | 'completed' | 'pending' | 'rejected' | 'info' | 'shift';
}

/**
 * Determines the sort priority for Job Transfer (บันทึกการย้ายงาน) status groups.
 * 0 = อยู่ระหว่างการส่ง / อยู่ระว่างการส่ง / กำลังส่ง (Always first at the top)
 * 1 = ส่งสินค้าเรียบร้อยแล้ว / สำเร็จ (Second, below in-transit)
 * 2 = Other statuses
 */
export function getJobTransferStatusPriority(status: string): number {
  const s = (status || '').trim();
  if (
    s.includes('ระหว่าง') ||
    s.includes('ระว่าง') ||
    s.includes('กำลังส่ง') ||
    s.includes('กำลังดำเนินการ')
  ) {
    return 0;
  }
  if (s.includes('เรียบร้อย') || s.includes('สำเร็จ')) {
    return 1;
  }
  return 2;
}

/**
 * Sorts Job Transfer group entries so that in-transit ("อยู่ระหว่างการส่ง")
 * always appears at the top, followed by completed ("ส่งสินค้าเรียบร้อยแล้ว") below.
 */
export function sortJobTransferGroups<T>(
  entries: Array<[string, T]>
): Array<[string, T]> {
  return [...entries].sort(([statusA], [statusB]) => {
    const prioA = getJobTransferStatusPriority(statusA);
    const prioB = getJobTransferStatusPriority(statusB);
    if (prioA !== prioB) {
      return prioA - prioB;
    }
    return 0;
  });
}

/**
 * Formats display label for Job Transfer status group header
 * so common typo "อยู่ระว่างการส่ง" in sheets can be clearly understood while preserving meaning.
 */
export function getGroupHeaderTheme(status: string, tabGid?: string): GroupHeaderTheme {
  const s = (status || '').trim();

  // 1. Job Transfer: อยู่ระหว่างการส่ง / อยู่ระว่างการส่ง (Vivid Amber / Orange)
  if (
    s.includes('ระหว่าง') ||
    s.includes('ระว่าง') ||
    s.includes('กำลังส่ง')
  ) {
    return {
      rowClassName:
        'bg-gradient-to-r from-amber-500/20 via-orange-500/12 to-amber-50/90 hover:from-amber-500/30 hover:via-orange-500/20 hover:to-amber-100/90 border-y border-amber-300/90',
      accentBarClassName: 'bg-amber-500',
      chevronBtnClassName:
        'bg-amber-500/20 text-amber-900 hover:bg-amber-500/30 border border-amber-400/50',
      iconBadgeClassName:
        'bg-amber-500 text-white shadow-xs ring-2 ring-amber-200/80',
      titleClassName: 'text-amber-950 font-extrabold tracking-tight',
      countBadgeClassName:
        'bg-amber-600 text-white font-bold shadow-2xs ring-1 ring-amber-700/20',
      actionHintClassName:
        'bg-white/80 text-amber-900 border border-amber-300/80 font-semibold shadow-2xs',
      iconType: 'in_transit',
    };
  }

  // 2. Job Transfer / Repair: ส่งสินค้าเรียบร้อยแล้ว / อนุมัติ / ซ่อมเสร็จแล้ว (Vivid Emerald / Green)
  if (
    s.includes('เรียบร้อย') ||
    s.includes('สำเร็จ') ||
    (s === 'อนุมัติ')
  ) {
    return {
      rowClassName:
        'bg-gradient-to-r from-emerald-500/20 via-teal-500/12 to-emerald-50/90 hover:from-emerald-500/30 hover:via-teal-500/20 hover:to-emerald-100/90 border-y border-emerald-300/90',
      accentBarClassName: 'bg-emerald-600',
      chevronBtnClassName:
        'bg-emerald-500/20 text-emerald-900 hover:bg-emerald-500/30 border border-emerald-400/50',
      iconBadgeClassName:
        'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-200/80',
      titleClassName: 'text-emerald-950 font-extrabold tracking-tight',
      countBadgeClassName:
        'bg-emerald-600 text-white font-bold shadow-2xs ring-1 ring-emerald-700/20',
      actionHintClassName:
        'bg-white/80 text-emerald-900 border border-emerald-300/80 font-semibold shadow-2xs',
      iconType: 'completed',
    };
  }

  // 3. Repair: รอตรวจสอบ (Vivid Blue)
  if (s === 'รอตรวจสอบ') {
    return {
      rowClassName:
        'bg-gradient-to-r from-blue-500/20 via-sky-500/12 to-blue-50/90 hover:from-blue-500/30 hover:via-sky-500/20 hover:to-blue-100/90 border-y border-blue-300/90',
      accentBarClassName: 'bg-blue-600',
      chevronBtnClassName:
        'bg-blue-500/20 text-blue-900 hover:bg-blue-500/30 border border-blue-400/50',
      iconBadgeClassName:
        'bg-blue-600 text-white shadow-xs ring-2 ring-blue-200/80',
      titleClassName: 'text-blue-950 font-extrabold tracking-tight',
      countBadgeClassName:
        'bg-blue-600 text-white font-bold shadow-2xs ring-1 ring-blue-700/20',
      actionHintClassName:
        'bg-white/80 text-blue-900 border border-blue-300/80 font-semibold shadow-2xs',
      iconType: 'info',
    };
  }

  // 4. Repair: รออนุมัติ / ขอข้อมูลเพิ่มเติม (Vivid Amber / Orange)
  if (s === 'รออนุมัติ' || s === 'ขอข้อมูลเพิ่มเติม' || s.includes('รอพิจารณา')) {
    return {
      rowClassName:
        'bg-gradient-to-r from-amber-500/20 via-orange-500/12 to-amber-50/90 hover:from-amber-500/30 hover:via-orange-500/20 hover:to-amber-100/90 border-y border-amber-300/90',
      accentBarClassName: 'bg-amber-500',
      chevronBtnClassName:
        'bg-amber-500/20 text-amber-900 hover:bg-amber-500/30 border border-amber-400/50',
      iconBadgeClassName:
        'bg-amber-500 text-white shadow-xs ring-2 ring-amber-200/80',
      titleClassName: 'text-amber-950 font-extrabold tracking-tight',
      countBadgeClassName:
        'bg-amber-600 text-white font-bold shadow-2xs ring-1 ring-amber-700/20',
      actionHintClassName:
        'bg-white/80 text-amber-900 border border-amber-300/80 font-semibold shadow-2xs',
      iconType: 'pending',
    };
  }

  // 5. Repair: ตอบกลับข้อมูลเพิ่มเติมแล้ว (Vivid Indigo / Violet)
  if (s === 'ตอบกลับข้อมูลเพิ่มเติมแล้ว' || s.includes('ตอบกลับ')) {
    return {
      rowClassName:
        'bg-gradient-to-r from-indigo-500/20 via-violet-500/12 to-indigo-50/90 hover:from-indigo-500/30 hover:via-violet-500/20 hover:to-indigo-100/90 border-y border-indigo-300/90',
      accentBarClassName: 'bg-indigo-600',
      chevronBtnClassName:
        'bg-indigo-500/20 text-indigo-900 hover:bg-indigo-500/30 border border-indigo-400/50',
      iconBadgeClassName:
        'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-200/80',
      titleClassName: 'text-indigo-950 font-extrabold tracking-tight',
      countBadgeClassName:
        'bg-indigo-600 text-white font-bold shadow-2xs ring-1 ring-indigo-700/20',
      actionHintClassName:
        'bg-white/80 text-indigo-900 border border-indigo-300/80 font-semibold shadow-2xs',
      iconType: 'info',
    };
  }

  // 6. Repair: ไม่อนุมัติ (Vivid Rose / Red)
  if (s === 'ไม่อนุมัติ' || s.includes('ไม่อนุมัติ')) {
    return {
      rowClassName:
        'bg-gradient-to-r from-rose-500/20 via-red-500/12 to-rose-50/90 hover:from-rose-500/30 hover:via-red-500/20 hover:to-rose-100/90 border-y border-rose-300/90',
      accentBarClassName: 'bg-rose-600',
      chevronBtnClassName:
        'bg-rose-500/20 text-rose-900 hover:bg-rose-500/30 border border-rose-400/50',
      iconBadgeClassName:
        'bg-rose-600 text-white shadow-xs ring-2 ring-rose-200/80',
      titleClassName: 'text-rose-950 font-extrabold tracking-tight',
      countBadgeClassName:
        'bg-rose-600 text-white font-bold shadow-2xs ring-1 ring-rose-700/20',
      actionHintClassName:
        'bg-white/80 text-rose-900 border border-rose-300/80 font-semibold shadow-2xs',
      iconType: 'rejected',
    };
  }

  // 7. Vehicle Shift or Default
  if (tabGid === '378250263' || s.startsWith('กะ:')) {
    return {
      rowClassName:
        'bg-gradient-to-r from-sky-500/18 via-indigo-500/10 to-sky-50/90 hover:from-sky-500/28 hover:via-indigo-500/18 hover:to-sky-100/90 border-y border-sky-300/90',
      accentBarClassName: 'bg-sky-600',
      chevronBtnClassName:
        'bg-sky-500/20 text-sky-900 hover:bg-sky-500/30 border border-sky-400/50',
      iconBadgeClassName:
        'bg-sky-600 text-white shadow-xs ring-2 ring-sky-200/80',
      titleClassName: 'text-sky-950 font-extrabold tracking-tight',
      countBadgeClassName:
        'bg-sky-600 text-white font-bold shadow-2xs ring-1 ring-sky-700/20',
      actionHintClassName:
        'bg-white/80 text-sky-900 border border-sky-300/80 font-semibold shadow-2xs',
      iconType: 'shift',
    };
  }

  return {
    rowClassName:
      'bg-gradient-to-r from-slate-200/90 via-slate-100 to-slate-50 hover:from-slate-300/80 hover:to-slate-100 border-y border-slate-300',
    accentBarClassName: 'bg-slate-600',
    chevronBtnClassName:
      'bg-slate-300/70 text-slate-800 hover:bg-slate-400/60 border border-slate-400/50',
    iconBadgeClassName: 'bg-slate-700 text-white shadow-xs',
    titleClassName: 'text-slate-900 font-extrabold tracking-tight',
    countBadgeClassName: 'bg-slate-700 text-white font-bold shadow-2xs',
    actionHintClassName:
      'bg-white/80 text-slate-700 border border-slate-300 font-semibold shadow-2xs',
    iconType: 'info',
  };
}
