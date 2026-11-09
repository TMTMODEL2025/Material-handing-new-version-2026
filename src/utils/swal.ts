import Swal from 'sweetalert2';

export function showSuccessToast(title: string, text?: string) {
  return Swal.fire({
    icon: 'success',
    title,
    text,
    timer: 1800,
    timerProgressBar: true,
    showConfirmButton: false,
    background: '#ffffff',
    color: '#0f172a',
    iconColor: '#059669',
    customClass: {
      popup: 'rounded-xl shadow-2xl border border-slate-200 font-sans',
      title: 'text-base font-bold text-slate-900',
      htmlContainer: 'text-xs text-slate-600',
    },
  });
}

export function showErrorAlert(title: string, text?: string) {
  return Swal.fire({
    icon: 'error',
    title,
    text,
    confirmButtonText: 'ตกลง',
    confirmButtonColor: '#0f172a',
    background: '#ffffff',
    color: '#0f172a',
    customClass: {
      popup: 'rounded-xl shadow-2xl border border-slate-200 font-sans',
      title: 'text-base font-bold text-slate-900',
      confirmButton: 'rounded-lg px-4 py-2 text-xs font-semibold text-white bg-slate-900',
    },
  });
}
