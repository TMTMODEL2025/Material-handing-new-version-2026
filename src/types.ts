export interface SheetTabConfig {
  gid: string;
  name: string;
  category: string;
  description: string;
  reverseOrder?: boolean;
  defaultLimit?: number;
}

export interface SheetColumn {
  id: string;
  label: string;
  type: string;
}

export interface SheetRow {
  rowNumber: number;
  values: Record<string, string>;
  rawValues: Record<string, string | number | null>;
}

export interface SheetDataResult {
  sheetId: string;
  gid: string;
  tabName: string;
  columns: SheetColumn[];
  allColumns?: SheetColumn[];
  rows: SheetRow[];
  totalRowsInSheet: number;
  fetchedAt: string;
}

export interface JobTransferPayload {
  date: string;
  employeeId: string;
  driverName: string;
  vehicleNumber: string;
  trailerNumber: string;
  productType: string;
  weight: number;
  origin: string;
  startTime: string;
  destination: string;
  endTime: string;
  duration: string;
  status: string;
  note: string;
  rounds: number;
}

export interface DeliveryPointPayload {
  date: string;
  deliveryPoint: string;
  gate: string;
}

export interface RepairRequestPayload {
  date: string;
  time: string;
  vehicleNumber: string;
  repairType: string;
  symptoms: string;
  reporterName: string;
  note?: string;
  repairRequestNo?: string;
  photos?: string[];
  sparePartsCost?: string;
  laborCost?: string;
}

export interface RepairApprovalPayload {
  rowNumber: number;
  sequenceNo: string;
  approvalStatus: '3.✔️อนุมัติ' | '1.❌ไม่อนุมัติ' | '2.⚠️รอพิจารณา' | '4.⚠️ขอข้อมูลเพิ่มเติม' | string;
  approverName: string;
  approvalDate: string;
  approvalTime: string;
  repairStatus?: string;
  note?: string;
}

export interface RepairPhotoUpdatePayload {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  photos: string[];
}

export interface RepairInspectionPayload {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  inspectorName: string;
  inspectionDate: string;
  inspectionTime: string;
  sparePartsCost?: string;
  laborCost?: string;
  note?: string;
}

export interface FuelRecordPayload {
  transactionType: 'รับเข้า' | 'เบิกออก';
  date: string;
  time: string;
  fuelType: 'ดีเซล' | 'เบนซิน' | string;
  litersIn?: number | string;
  pricePerLiter?: number | string;
  litersOut?: number | string;
  amountBaht?: number | string;
  totalInDiesel: number;
  totalInBenzene: number;
  totalOutDiesel: number;
  totalOutBenzene: number;
  balanceDiesel: number;
  balanceBenzene: number;
  vehicleNumber?: string;
  mileage?: number | string;
  driverName?: string;
  issuerName?: string;
  receiverName?: string;
  requisitionNo?: string;
  note?: string;
  monthLabel: string;
}

