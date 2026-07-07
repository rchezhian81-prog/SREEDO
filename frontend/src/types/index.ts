export type UserRole =
  | "super_admin"
  | "admin"
  | "teacher"
  | "accountant"
  | "student"
  | "parent";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  phone?: string | null;
  institutionId?: string | null;
}

export interface PortalChild {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  sectionId: string | null;
  sectionName: string | null;
  className: string | null;
  relationship: string | null;
}

export interface StudentSummary {
  profile: Student & { sectionName: string | null; className: string | null };
  attendance: {
    total: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    rate: number | null;
  };
  fees: {
    totalDue: number;
    totalPaid: number;
    outstanding: number;
    pendingInvoices: number;
  };
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface DocumentMeta {
  id: string;
  ownerType: string;
  ownerId: string | null;
  category: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageMode: string;
  uploadedBy: string | null;
  createdAt: string;
}

export interface Student {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  sectionId: string | null;
  sectionName: string | null;
  className: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  guardianRelation: string | null;
  address: string | null;
  bloodGroup: string | null;
  nationality: string | null;
  religion: string | null;
  category: string | null;
  nationalId: string | null;
  admissionDate: string | null;
  rollNumber: string | null;
  previousSchool: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  status: string;
}

export interface Teacher {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  qualification: string | null;
  specialization: string | null;
  isActive: boolean;
}

export interface Section {
  id: string;
  name: string;
  capacity: number;
  studentCount: number;
}

export interface SchoolClass {
  id: string;
  name: string;
  gradeLevel: number;
  sections: Section[];
}

export interface AttendanceRow {
  studentId: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  sectionId: string | null;
  status: "present" | "absent" | "late" | "excused" | null;
  remarks: string | null;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  description: string;
  amountDue: string;
  amountPaid: string;
  dueDate: string;
  status: "pending" | "partially_paid" | "paid" | "cancelled";
}

export interface Payment {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  paidAt: string;
}

export interface InvoiceWithPayments extends Invoice {
  payments: Payment[];
}

export interface FeeSummary {
  totalInvoiced: number;
  totalCollected: number;
  outstanding: number;
  pendingInvoices: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: string;
  isPinned: boolean;
  publishedAt: string;
  scheduled: boolean;
  createdByName: string | null;
}

export interface InboxMessage {
  id: string;
  readAt: string | null;
  category: string;
  subject: string;
  body: string;
  createdAt: string;
  senderName: string | null;
}

export interface SentMessage {
  id: string;
  category: string;
  subject: string;
  audienceType: string | null;
  createdAt: string;
  senderName: string | null;
  recipientCount: number;
  readCount: number;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
}

export interface ClassSubject {
  id: string;
  sectionId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  teacherId: string | null;
  teacherName: string | null;
}

export interface Homework {
  id: string;
  sectionId: string;
  sectionName: string | null;
  className: string | null;
  subjectId: string;
  subjectName: string | null;
  title: string;
  description: string;
  instructions: string | null;
  dueDate: string | null;
  maxMarks: string | null;
  attachmentCount: number;
  submissionCount: number;
  createdAt: string;
}

export interface HomeworkAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface HomeworkDetail extends Homework {
  attachments: HomeworkAttachment[];
  submission: {
    id: string;
    content: string | null;
    status: string;
    marks: string | null;
    remarks: string | null;
    submittedAt: string;
    reviewedAt: string | null;
  } | null;
}

export interface HomeworkSubmission {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  content: string | null;
  status: string;
  marks: string | null;
  remarks: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  attachmentCount: number;
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface Exam {
  id: string;
  name: string;
  academicYearId: string | null;
  academicYearName: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface ExamResultRow {
  studentId: string;
  firstName: string;
  lastName: string;
  admissionNo: string;
  subjectName: string;
  marksObtained: string;
  maxMarks: string;
  grade: string | null;
}

export interface GradeBand {
  id: string;
  grade: string;
  minPercent: string; // NUMERIC → returned as strings e.g. "90.00"
  maxPercent: string;
  remark: string | null;
  sortOrder: number;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
}

export interface AccountUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  phone: string | null;
  isActive: boolean;
  twoFactorEnabled: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  createdAt: string;
}

export interface Branch {
  id: string;
  institutionId: string;
  name: string;
  address: string | null;
  timezone: string;
  isActive: boolean;
}

export interface InstitutionSubscription {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  packageId: string;
  packageName: string;
}

export interface Institution {
  id: string;
  name: string;
  code: string;
  type: "school" | "college";
  isActive: boolean;
  branchCount?: string | number;
  branches?: Branch[];
  subscription?: InstitutionSubscription | null;
}

export interface SubscriptionPackage {
  id: string;
  name: string;
  maxStudents: number | null;
  maxStaff: number | null;
  price: string | number;
  billingCycle: "monthly" | "quarterly" | "annual";
  isActive: boolean;
}

// --- Super Admin console (platform hardening) ---

/** Brief institution row from GET /admin/institutions (selectors). */
export interface AdminInstitutionBrief {
  id: string;
  name: string;
  code: string;
  type: "school" | "college";
  isActive: boolean;
}

export interface InstitutionSettings {
  id: string;
  name: string;
  code: string;
  type: "school" | "college";
  isActive: boolean;
  settings: {
    contact?: {
      email?: string | null;
      phone?: string | null;
      address?: string | null;
    };
    enabledModules?: string[];
    featureFlags?: Record<string, boolean>;
    academicYearDefaults?: Record<string, unknown>;
  } | null;
}

export interface InstitutionLimits {
  packageName: string;
  maxStudents: number | null;
  students: number;
  maxStaff: number | null;
  staff: number;
  storageLimitMb: number | null;
  smsQuota: number | null;
  withinLimits: boolean;
}

export interface InstitutionStats {
  students: number;
  teachers: number;
  classes: number;
  sections: number;
  subjects: number;
  users: number;
  feesOutstanding: number | string;
}

export interface AuditLogEntry {
  id: string;
  method: string;
  path: string;
  module: string | null;
  statusCode: number | null;
  userRole: string | null;
  userId: string | null;
  institutionId: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditLogResponse {
  available: boolean;
  rows: AuditLogEntry[];
}

export interface DataExportSummary {
  institution: { name: string; code: string; type: string };
  counts: Record<string, number>;
  generatedAt: string;
}

export interface DataExport {
  id: string;
  institutionId: string;
  institutionName?: string;
  kind: string;
  status: string;
  summary: DataExportSummary;
  createdAt: string;
}

export interface SystemHealth {
  postgres: boolean;
  mongo: boolean;
  auditLog: boolean;
  institutions: number;
  users: number;
  uptimeSeconds: number;
}

export interface Period {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  isBreak: boolean;
}

export interface Room {
  id: string;
  name: string;
  code: string;
  capacity: number | null;
  building: string | null;
}

export interface TimetableEntry {
  id: string;
  sectionId: string;
  sectionName: string;
  className: string;
  dayOfWeek: number;
  periodId: string;
  periodName: string;
  startTime: string;
  endTime: string;
  periodOrder: number;
  subjectId: string;
  subjectName: string;
  teacherId: string | null;
  teacherName: string | null;
  roomId: string | null;
  roomName: string | null;
}

export interface ReportMeta {
  key: string;
  title: string;
  category: string;
  permission: string;
}

export interface ReportData {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}

export interface DashboardStats {
  activeStudents: number;
  activeTeachers: number;
  classes: number;
  attendanceToday: { marked: number; present: number; rate: number | null };
  fees: {
    pendingInvoices: number;
    totalInvoiced: number;
    totalCollected: number;
  };
}

// --- College Mode ---

export interface CollegeOverview {
  type: "school" | "college";
  departments: number;
  programs: number;
  semesters: number;
  enrollments: number;
}

export interface CollegeDepartment {
  id: string;
  name: string;
  code: string;
  headTeacherId: string | null;
  headTeacherName: string | null;
  programCount: number;
}

export interface CollegeProgram {
  id: string;
  name: string;
  code: string;
  departmentId: string;
  departmentName: string | null;
  durationSemesters: number | null;
}

export interface CollegeSemester {
  id: string;
  name: string;
  number: number;
  programId: string;
  programName: string | null;
  academicYearId: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface CollegeBatch {
  id: string;
  name: string;
  startYear: number | null;
  programId: string;
}

export interface CollegeProgramSubject {
  id: string;
  programId: string;
  semesterId: string | null;
  semesterName: string | null;
  subjectId: string;
  subjectName: string | null;
  credits: number | null;
}

export interface CollegeEnrollment {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  programId: string;
  programName: string | null;
  semesterId: string | null;
  semesterName: string | null;
  batchId: string | null;
  status: string;
}

export interface CollegeResultSubject {
  subject: string;
  credits: number | null;
  percent: number | null;
  grade: string | null;
  gradePoint: number | null;
}

export interface CollegeSemesterResult {
  semesterId: string;
  semesterName: string;
  subjects: CollegeResultSubject[];
  totalCredits: number;
  gpa: number | null;
}

export interface CollegeCgpa {
  programId: string;
  cgpa: number | null;
  totalCredits: number;
  perSemester: { semesterId: string; gpa: number | null }[];
}

// --- Library ---

export interface LibrarySettings {
  loanDays: number;
  finePerDay: number;
  maxRenewals: number;
  maxBooksPerMember: number;
}

export interface BookCategory {
  id: string;
  name: string;
  code: string | null;
  bookCount: number;
}

export interface LibraryBook {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  edition: string | null;
  subject: string | null;
  language: string | null;
  rackLocation: string | null;
  categoryId: string | null;
  categoryName: string | null;
  totalCopies: number;
  availableCopies: number;
}

export type BookCopyStatus =
  | "available"
  | "issued"
  | "lost"
  | "damaged"
  | "retired";

export interface BookCopy {
  id: string;
  accessionNumber: string | null;
  barcode: string | null;
  status: BookCopyStatus;
}

export interface LibraryBookDetail extends LibraryBook {
  copies: BookCopy[];
}

export type LibraryMemberType = "student" | "staff";

export interface LibraryMember {
  id: string;
  memberType: LibraryMemberType;
  memberCode: string | null;
  status: string;
  studentId: string | null;
  teacherId: string | null;
  name: string;
  identifier: string | null;
  openLoans: number;
}

export interface LibraryHistoryRow {
  id: string;
  bookId: string;
  title: string;
  accessionNumber: string | null;
  issueDate: string;
  dueDate: string;
  returnDate: string | null;
  status: string;
  renewedCount: number;
  fineAmount: number | string | null;
  fineStatus: string | null;
  overdue: boolean;
}

// --- Transport ---

export interface Vehicle {
  id: string;
  registrationNo: string;
  type: string | null;
  capacity: number | null;
  insuranceExpiry: string | null;
  fitnessExpiry: string | null;
  permitExpiry: string | null;
  isActive: boolean;
  routeCount: number;
}

export interface Driver {
  id: string;
  name: string;
  phone: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  helperName: string | null;
  helperPhone: string | null;
  isActive: boolean;
  routeCount: number;
}

export interface TransportRoute {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  vehicleId: string | null;
  vehicleNo: string | null;
  driverId: string | null;
  driverName: string | null;
  stopCount: number;
  studentCount: number;
}

export interface RouteStop {
  id: string;
  routeId: string;
  name: string;
  stopOrder: number;
  pickupTime: string | null;
  dropTime: string | null;
  distanceKm: number | string | null;
  zone: string | null;
}

export type TransportTripType = "pickup" | "drop" | "both";

export interface TransportAllocation {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  routeId: string;
  routeName: string;
  stopId: string | null;
  stopName: string | null;
  tripType: string;
  effectiveDate: string | null;
  status: string;
}

export interface TransportFee {
  id: string;
  routeId: string;
  routeName: string;
  stopId: string | null;
  stopName: string | null;
  amount: number | string;
  frequency: string;
}

export interface TransportTrip {
  id: string;
  routeId: string;
  tripDate: string;
  tripType: "pickup" | "drop";
  vehicleId: string | null;
  driverId: string | null;
  status: string;
}

// --- Hostel ---

export type HostelType = "boys" | "girls" | "co_ed" | "staff";

export interface Hostel {
  id: string;
  name: string;
  code: string;
  type: HostelType | string | null;
  address: string | null;
  wardenName: string | null;
  wardenPhone: string | null;
  contactPhone: string | null;
  capacity: number | null;
  isActive: boolean;
  roomCount: number;
  bedCount: number;
  occupied: number;
}

export interface HostelBlock {
  id: string;
  hostelId: string;
  name: string;
}

export type HostelRoomStatus =
  | "available"
  | "occupied"
  | "maintenance"
  | "inactive";

export interface HostelRoom {
  id: string;
  hostelId: string;
  blockId: string | null;
  blockName: string | null;
  roomNumber: string;
  floor: string | null;
  roomType: string | null;
  capacity: number;
  status: HostelRoomStatus | string;
  occupied: number;
  availableBeds: number;
}

export interface HostelAllocation {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  hostelId: string;
  hostelName: string;
  roomId: string;
  roomNumber: string;
  bedNo: string | null;
  allocationDate: string | null;
  vacateDate: string | null;
  status: string;
}

export interface HostelFee {
  id: string;
  hostelId: string;
  hostelName: string;
  roomType: string | null;
  amount: number | string;
  frequency: string;
}

// --- Inventory ---

export interface ItemCategory {
  id: string;
  name: string;
  code: string | null;
  itemCount: number;
}

export interface Vendor {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstNumber: string | null;
  address: string | null;
  paymentTerms: string | null;
  isActive: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  code: string;
  unit: string | null;
  categoryId: string | null;
  categoryName: string | null;
  openingStock: number;
  currentStock: number;
  minStockLevel: number;
  location: string | null;
  isActive: boolean;
  lowStock: boolean;
}

export interface StockMovement {
  id: string;
  type: string;
  change: number;
  balanceAfter: number;
  refTable: string | null;
  note: string | null;
  createdAt: string;
}

export interface Purchase {
  id: string;
  vendorId: string | null;
  vendorName: string | null;
  purchaseDate: string;
  billNo: string | null;
  totalAmount: number | string;
  documentId: string | null;
  notes: string | null;
  lineCount: number;
}

export interface PurchaseItem {
  id: string;
  itemId: string;
  itemName: string;
  unit: string | null;
  quantity: number | string;
  rate: number | string | null;
  amount: number | string;
}

export interface PurchaseDetail extends Purchase {
  items: PurchaseItem[];
}

export interface StockIssue {
  id: string;
  itemId: string;
  itemName: string;
  unit: string | null;
  quantity: number | string;
  issuedToType: string | null;
  issuedTo: string | null;
  purpose: string | null;
  issueDate: string;
  receivedBy: string | null;
}

export interface StockAdjustment {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number | string;
  reason: string | null;
  note: string | null;
  approvedBy: string | null;
  createdAt: string;
}

// --- Staff Attendance & Leave ---

export type StaffAttendanceStatus =
  | "present"
  | "absent"
  | "half_day"
  | "leave"
  | "holiday";

export interface StaffAttendance {
  id: string;
  teacherId: string;
  teacherName: string;
  employeeNo: string;
  date: string;
  status: StaffAttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  late: boolean;
  earlyOut: boolean;
  leaveTypeId: string | null;
  remarks: string | null;
}

export interface StaffAttendanceSummary {
  teacherId: string;
  employeeNo: string;
  name: string;
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  holiday: number;
  lateCount: number;
}

export interface PayrollSummary {
  teacherId: string;
  employeeNo: string;
  name: string;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  paidLeave: number;
  unpaidLeave: number;
  lateCount: number;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  isPaid: boolean;
  defaultBalance: number;
  isActive: boolean;
}

// --- Payroll ---

export type PayrollComponentType = "earning" | "deduction";
export type PayrollCalcType = "fixed" | "percent";

export interface SalaryComponent {
  id: string;
  name: string;
  code: string;
  type: PayrollComponentType;
  calcType: PayrollCalcType;
  defaultValue: number | string | null;
  isActive: boolean;
}

export interface SalaryStructure {
  id: string;
  teacherId: string;
  teacherName: string;
  employeeNo: string;
  effectiveDate: string | null;
  isActive: boolean;
  fixedEarnings: number | string;
}

export interface SalaryStructureLine {
  id: string;
  componentId: string;
  name: string;
  code: string;
  type: PayrollComponentType;
  calcType: PayrollCalcType;
  value: number | string;
}

export interface SalaryStructureDetail extends SalaryStructure {
  components: SalaryStructureLine[];
}

export type PayrollRunStatus = "draft" | "finalized";

export interface PayrollRun {
  id: string;
  month: string;
  status: PayrollRunStatus;
  notes: string | null;
  finalizedAt: string | null;
  payslipCount: number | string;
  netTotal: number | string;
}

export type PayslipStatus = "draft" | "finalized";

export interface Payslip {
  id: string;
  teacherId: string;
  teacherName: string;
  employeeNo: string;
  month: string;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  paidLeave: number;
  unpaidLeave: number;
  halfDays: number;
  gross: number | string;
  deductions: number | string;
  net: number | string;
  status: PayslipStatus;
}

export interface PayslipLine {
  name: string;
  type: PayrollComponentType;
  amount: number | string;
}

export interface PayslipDetail extends Payslip {
  lines: PayslipLine[];
}

export interface LeaveBalance {
  id: string;
  teacherId: string;
  teacherName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  isPaid: boolean;
  balance: number;
}

export type LeaveRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export interface LeaveRequest {
  id: string;
  teacherId: string;
  teacherName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: LeaveRequestStatus;
  decidedAt: string | null;
  decisionNote: string | null;
}

// --- AI Insights ---

export interface AiSuggestion {
  key: string;
  label: string;
  count: number;
  href: string;
}

export interface AiDashboard {
  aiAvailable: boolean;
  headline: {
    students: number;
    staff: number;
    feesOutstanding: number;
    attendanceRate: number | null;
  };
  suggestionCount: number;
  suggestions: AiSuggestion[];
}

export interface AiSummary {
  report: string;
  metrics: Record<string, number>;
  narrative: string | null;
  aiAvailable: boolean;
}

export interface AiAttendanceRiskStudent {
  studentId: string;
  admissionNo: string;
  name: string;
  present: number;
  total: number;
  rate: number;
}

export interface AiAttendanceRisk {
  threshold: number;
  windowDays: number;
  count: number;
  students: AiAttendanceRiskStudent[];
  narrative: string | null;
  aiAvailable: boolean;
}

export interface AiFeeRiskInvoice {
  id: string;
  invoiceNo: string;
  student: string;
  outstanding: number;
  dueDate: string | null;
  overdue: boolean;
}

export interface AiFeeRisk {
  pendingCount: number;
  overdueCount: number;
  totalOutstanding: number;
  invoices: AiFeeRiskInvoice[];
  suggestedAction: string | null;
  narrative: string | null;
  aiAvailable: boolean;
}

export interface AiDocSearchResult {
  id: string;
  name: string;
  category: string;
  ownerType: string;
  score?: number;
}

export interface AiDocSearch {
  mode: "semantic" | "keyword";
  results: AiDocSearchResult[];
}

// --- Online Fee Gateway ---

export interface PaymentOrder {
  id: string; orderNo: string; invoiceId: string; invoiceNo: string;
  studentId: string; studentName: string; amount: number | string; currency: string;
  status: "created" | "pending" | "success" | "failed" | "cancelled" | "expired" | "refunded";
  provider: string; gatewayRef: string | null; gatewayPaymentId: string | null;
  paymentId: string | null; checkoutUrl: string | null; createdAt: string; updatedAt: string;
}

export interface GatewayStatus {
  configured: boolean; provider: string | null; currency: string;
  institutionEnabled: boolean; enabled: boolean;
}

// --- Fee Management Depth ---

export interface FeeCategory {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  createdAt: string;
}

export type FeeTermType =
  | "one_time"
  | "monthly"
  | "quarterly"
  | "term"
  | "annual";

export interface FeeSchedule {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  amount: number | string;
  termType: FeeTermType | string;
  termLabel: string | null;
  dueDate: string;
  classId: string | null;
  sectionId: string | null;
  programId: string | null;
  semesterId: string | null;
  studentId: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface FeeSchedulePreview {
  schedule: FeeSchedule;
  targetCount: number;
  toGenerate: number;
  students: { id: string; name: string; alreadyInvoiced: boolean }[];
}

export type FineType = "fixed" | "per_day" | "percent";

export interface FineRule {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  fineType: FineType | string;
  amount: number | string;
  graceDays: number | null;
  createdAt: string;
}

export type DiscountKind = "discount" | "scholarship";
export type DiscountType = "fixed" | "percent";

export interface FeeDiscount {
  id: string;
  name: string;
  kind: DiscountKind | string;
  categoryId: string | null;
  categoryName: string | null;
  discountType: DiscountType | string;
  value: number | string;
  createdAt: string;
}

export interface InvoiceBreakdown {
  invoice: {
    invoiceNo: string;
    amountDue: number | string;
    amountPaid: number | string;
    discountTotal: number | string;
    fineTotal: number | string;
    status: string;
    categoryName: string | null;
  };
  base: number | string;
  discountTotal: number | string;
  fineTotal: number | string;
  outstanding: number | string;
  fines: {
    id: string;
    amount: number | string;
    days: number | null;
    status: string;
    reason: string | null;
    createdAt: string;
  }[];
  discounts: {
    id: string;
    amount: number | string;
    status: string;
    reason: string | null;
    createdAt: string;
  }[];
}

// --- Transfer Certificates ---

export interface TransferCertificate {
  id: string;
  tcNo: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string | null;
  sectionName: string | null;
  programName: string | null;
  semesterName: string | null;
  academicYear: string | null;
  dateOfIssue: string | null;
  lastAttendanceDate: string | null;
  leavingReason: string | null;
  conduct: string | null;
  feeDuesStatus: string | null;
  libraryDuesStatus: string | null;
  transportDuesStatus: string | null;
  hostelDuesStatus: string | null;
  duesOverride: boolean;
  duesOverrideReason: string | null;
  remarks: string | null;
  status: "draft" | "issued" | "cancelled";
  issuedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface StudentDues {
  fee: { amount: number | string; count: number };
  transport: { amount: number | string };
  hostel: { amount: number | string };
  library: { books: number; fines: number | string };
  hasDues: boolean;
}

// --- Threaded Messaging ---

export type ThreadType = "direct" | "group";

export interface Thread {
  id: string;
  subject: string | null;
  type: ThreadType;
  lastMessageAt: string | null;
  createdAt: string;
  lastMessage: string | null;
  unreadCount: number;
  participants: string;
}

export interface ThreadParticipant {
  userId: string;
  name: string;
  role: string;
  lastReadAt: string | null;
}

export interface ThreadMessage {
  id: string;
  senderId: string | null;
  senderName: string | null;
  body: string;
  createdAt: string;
}

export interface ThreadDetail {
  id: string;
  subject: string | null;
  type: ThreadType;
  createdBy: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  participants: ThreadParticipant[];
  messages: ThreadMessage[];
}

// --- Custom Report Builder ---

export interface ReportSource {
  key: string;
  title: string;
  category: string;
  permission: string;
}

export interface ReportColumn {
  key: string;
  label: string;
}

export interface CustomReportResult {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

export interface CustomReport {
  id: string;
  name: string;
  reportKey: string;
  columns: string[];
  filters: Record<string, string>;
  sort: { key: string; dir: string } | null;
  groupBy: string | null;
  visibility: "private" | "shared";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// --- Disciplinary Records ---

export type DisciplinarySeverity = "low" | "medium" | "high" | "critical";

export type DisciplinaryStatus =
  | "open"
  | "under_review"
  | "action_taken"
  | "closed"
  | "cancelled";

export interface DisciplinaryRecord {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string | null;
  sectionName: string | null;
  programName: string | null;
  semesterName: string | null;
  incidentDate: string;
  category: string;
  severity: DisciplinarySeverity;
  description: string | null;
  reportedBy: string | null;
  involvedStaff: string | null;
  actionTaken: string | null;
  followUpDate: string | null;
  status: DisciplinaryStatus;
  remarks: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface DisciplinaryAction {
  id: string;
  action: string;
  note: string | null;
  fromStatus: DisciplinaryStatus | null;
  toStatus: DisciplinaryStatus | null;
  byName: string | null;
  createdAt: string;
}

export interface DisciplinarySettings {
  portalEnabled: boolean;
}

// --- Scheduled Reports ---

export type ScheduleFrequency = "daily" | "weekly" | "monthly";

export type ScheduleChannel = "in_app" | "email";

export type ScheduleExportFormat = "csv" | "pdf" | "both";

export type ScheduledReportRunStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export type ScheduledReportTrigger = "manual" | "scheduled";

export interface ScheduledReportLastRun {
  status: ScheduledReportRunStatus;
  completedAt: string | null;
}

export interface ScheduledReport {
  id: string;
  reportId: string;
  reportName: string;
  name: string;
  frequency: ScheduleFrequency;
  runTime: string;
  timezone: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  recipients: string[];
  channels: ScheduleChannel[];
  exportFormat: ScheduleExportFormat;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastRun: ScheduledReportLastRun | null;
}

export interface ScheduledReportRun {
  id: string;
  scheduleId: string;
  status: ScheduledReportRunStatus;
  trigger: ScheduledReportTrigger;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  exportFormat: ScheduleExportFormat;
  exportBytes: number | null;
  rowCount: number | null;
  recipientCount: number | null;
  deliveryStatus: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

// --- Super Admin Console: Platform Hardening (/platform/*) ---

export interface PlatformModuleAdoption {
  withStudents: number;
  withFees: number;
  withOnlinePayments: number;
  withLibrary: number;
  withScheduledReports: number;
}

/** Aggregate platform metrics from GET /platform/kpis. */
export interface PlatformKpis {
  totalInstitutions: number;
  activeInstitutions: number;
  suspendedInstitutions: number;
  activeSubscriptions: number;
  totalStudents: number;
  totalStaff: number;
  totalUsers: number;
  feesOutstanding: number | string;
  onlinePaymentsTotal: number | string;
  totalDocuments: number;
  storageBytes: number | string;
  scheduledReports: number;
  customReports: number;
  activeSessions: number;
  moduleAdoption: PlatformModuleAdoption;
}

/** Platform-level health from GET /platform/health (mirrors SystemHealth). */
export type PlatformHealth = SystemHealth;

/** Subscription counts by lifecycle status (from GET /platform/revenue). */
export interface PlatformRevenueByStatus {
  active: number;
  trialing: number;
  suspended: number;
  cancelled: number;
  expired: number;
}

/** Per-currency revenue slice (money is never summed across currencies). */
export interface PlatformRevenueByCurrency {
  currency: string;
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  deferredRevenue: number;
}

/** One point on the monthly invoice-total trend (YYYY-MM). */
export interface PlatformRevenueTrendPoint {
  month: string;
  total: number;
}

/**
 * SaaS-operator revenue report from GET /platform/revenue. Headline figures
 * (mrr/arr/deferredRevenue) are in `currency` (the dominant currency);
 * `mixedCurrency` warns when more than one currency is present.
 */
export interface PlatformRevenue {
  currency: string;
  mixedCurrency: boolean;
  mrr: number;
  arr: number;
  byStatus: PlatformRevenueByStatus;
  trialingCount: number;
  deferredRevenue: number;
  byCurrency: PlatformRevenueByCurrency[];
  trend: PlatformRevenueTrendPoint[];
}

/** Institution row from GET /platform/institutions. */
export interface PlatformInstitution {
  id: string;
  name: string;
  code: string;
  type: "school" | "college";
  isActive: boolean;
  createdAt: string;
  students: number;
  staff: number;
  users: number;
  packageName: string | null;
}

export interface PlatformInstitutionBranch {
  id: string;
  name: string;
  address?: string | null;
  timezone?: string | null;
}

export interface PlatformInstitutionSubscription {
  id?: string;
  packageId?: string | null;
  packageName: string | null;
  status: string;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** Plan usage block returned in institution detail (`limits`). */
export interface PlatformInstitutionLimits {
  packageName: string | null;
  maxStudents: number | null;
  students: number;
  maxStaff: number | null;
  staff: number;
  maxBranches: number | null;
  branches: number;
  storageLimitMb: number | null;
  reportsQuota: number | null;
  withinLimits?: boolean;
}

/** Operational stats block returned in institution detail (`stats`). */
export interface PlatformInstitutionStats {
  students: number;
  teachers: number;
  classes: number;
  users: number;
  feesOutstanding: number | string;
  [key: string]: number | string;
}

/** Full institution detail from GET /platform/institutions/:id. */
export interface PlatformInstitutionDetail {
  id: string;
  name: string;
  code: string;
  type: "school" | "college";
  isActive: boolean;
  createdAt?: string;
  settings: Record<string, unknown> | null;
  branches: PlatformInstitutionBranch[];
  subscription: PlatformInstitutionSubscription | null;
  limits: PlatformInstitutionLimits | null;
  stats: PlatformInstitutionStats | null;
}

/** Durable cross-tenant audit row from GET /platform/audit. */
export interface PlatformAuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  institutionId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
}

/** Scoped support session from POST /platform/impersonate. */
export interface ImpersonationResult {
  impersonating: boolean;
  token: string;
  expiresAt: string | null;
  user: {
    id: string;
    email: string;
    role: UserRole;
    institutionId: string | null;
    fullName: string;
  };
}

/** A row from GET /platform/users (support-access selector). */
export interface PlatformUserSearchRow {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  institutionId: string;
  institutionName: string;
  institutionCode: string;
}

/** A row from GET /platform/audit (paginated cross-tenant audit log). The
 *  consolidated Audit Console adds computed category/severity/result and the
 *  extracted `reason` on top of the frozen store columns. */
export interface PlatformAuditRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  institutionId: string | null;
  institutionName: string | null;
  institutionCode: string | null;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  reason?: string | null;
  category?: string;
  severity?: string;
  result?: string;
}

// --- Super Admin F: Audit Consolidation (/platform/audit/*) ---

/** Category counts for the summary dashboard buckets. */
export interface AuditBuckets {
  authSecurity: number;
  tenant: number;
  billingInvoice: number;
  rbacSecurity: number;
  support: number;
  export: number;
}

/** A top actor by event count (GET /platform/audit/summary). */
export interface AuditTopActor {
  actorEmail: string;
  count: number;
}

/** A top tenant by event count (GET /platform/audit/summary). */
export interface AuditTopTenant {
  institutionName: string;
  institutionCode: string;
  count: number;
}

/** Dashboard summary over a window (GET /platform/audit/summary). */
export interface AuditSummary {
  window: "today" | "7d" | "30d" | "custom";
  totalEvents: number;
  highRiskCount: number;
  failedBlockedCount: number;
  buckets: AuditBuckets;
  topActors: AuditTopActor[];
  topTenants: AuditTopTenant[];
  recentCritical: PlatformAuditRow[];
}

/** A read-only suspicious-activity alert (GET /platform/audit/alerts). Each
 *  links back to a concrete audit row via `auditId`. */
export interface AuditAlert {
  key: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  count: number;
  auditId: string;
  action: string;
  actorEmail: string | null;
  lastAt: string;
}

/** One before/after change extracted from an event's detail. */
export interface AuditDiffRow {
  field: string;
  from: unknown;
  to: unknown;
  kind: "added" | "removed" | "changed";
}

/** Single audit event detail (GET /platform/audit/:id). `metadata` is the full
 *  detail AFTER server-side secret masking. */
export interface AuditEventDetail {
  id: string;
  action: string;
  category: string;
  severity: string;
  result: string;
  timestamp: string;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  actor: { id: string | null; email: string | null; role: string | null };
  target: { type: string | null; id: string | null; name: string | null };
  institution: { id: string; name: string; code: string } | null;
  diff: AuditDiffRow[];
  metadata: Record<string, unknown>;
}

/** A saved audit filter (GET/POST/PATCH /platform/audit/saved-filters). */
export interface AuditSavedFilter {
  id: string;
  name: string;
  ownerId: string | null;
  isShared: boolean;
  isDefault: boolean;
  filters: Record<string, unknown>;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  isOwn: boolean;
}

/** Audit retention policy + live store stats (GET/PUT /platform/audit/retention).
 *  Policy VISIBILITY only — the platform never auto-deletes audit history. */
export interface AuditRetention {
  status: "not_configured" | "configured" | "archived";
  retentionDays: number | null;
  archiveEnabled: boolean;
  updatedByEmail: string | null;
  updatedAt: string | null;
  stats: {
    totalEvents: number;
    oldestEventAt: string | null;
    growingLargeWarning: boolean;
  };
}

/** Integrity status (GET /platform/audit/integrity). Hash-chaining is a
 *  documented future enhancement — never faked. */
export interface AuditIntegrity {
  enabled: boolean;
  status: string;
  note: string;
}

/** Taxonomy reference for the filter dropdowns (GET /platform/audit/categories). */
export interface AuditCategoriesRef {
  categories: { value: string; label: string }[];
  severities: string[];
  results: string[];
}

// --- Background Job Queue ---

export type JobStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

/** A queued background job from GET /jobs and GET /jobs/:id. */
export interface BackgroundJob {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  dedupeKey: string | null;
  institutionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Result of POST /jobs/run-scheduler. */
export interface JobSchedulerResult {
  due: number;
  enqueued: number;
}

/** Result of POST /jobs/process. */
export interface JobProcessResult {
  processed: number;
  success: number;
  failed: number;
  retried: number;
}

// --- Phase E: Observability (super-admin, /observability/*) ---

/** A recently failed background job, from observability overview. */
export interface ObservabilityRecentFailure {
  id: string;
  type: string;
  error: string | null;
  institutionId: string | null;
  completedAt: string | null;
}

/** Aggregate request/job/report metrics from GET /observability/overview. */
export interface ObservabilityOverview {
  requests: {
    total: number;
    errors: number;
    byStatusClass: Record<string, number>;
    avgDurationMs: number;
  };
  jobs: {
    success: number;
    failed: number;
    retried: number;
    queue: Record<string, number>;
  };
  scheduledReports: Record<string, number>;
  /** Hot-path read cache counters (in-process). */
  cache: {
    hits: number;
    misses: number;
    invalidations: number;
    size: number;
  };
  recentFailures: ObservabilityRecentFailure[];
  worker: { enabled: boolean; intervalMs: number };
}

/** Live health snapshot from GET /observability/health. */
export interface ObservabilityHealth {
  status: string;
  postgres: boolean;
  mongo: boolean;
  migrations: number;
  queue: Record<string, number>;
  jobWorkerEnabled: boolean;
  storageConfigured: boolean;
  uptimeSeconds: number;
}

// --- Super Admin L: Health / Observability console (/observability/*) ---
//
// The composed Health & Observability views. Every timestamp is an ISO string;
// `null` is used wherever the backend can return null. Shapes mirror the FIXED
// backend contract (opsdashboard/incidents/alerts/errors services). Status-only —
// the backend never emits secrets, stacks, headers or raw storage paths.

/** A single dependency health check (status + secret-free detail). */
export type ServiceStatus = "healthy" | "degraded" | "down" | "unknown";

export type IncidentSeverity = "info" | "minor" | "major" | "critical";
export type IncidentStatus =
  | "open"
  | "investigating"
  | "monitoring"
  | "resolved"
  | "closed";
export type IncidentType =
  | "api"
  | "database"
  | "frontend"
  | "worker"
  | "email"
  | "storage"
  | "backup"
  | "payment"
  | "security"
  | "other";
export type AlertRuleType =
  | "api_down"
  | "db_down"
  | "mongo_down"
  | "worker_down"
  | "scheduler_stalled"
  | "queue_depth_high"
  | "job_failure_spike"
  | "error_rate_high"
  | "latency_high"
  | "smtp_failures"
  | "storage_high"
  | "backup_failed"
  | "gateway_degraded"
  | "disk_low"
  | "memory_high"
  | "security_event";
export type AlertStatus = "triggered" | "acknowledged" | "resolved" | "suppressed";
export type ErrorTriageStatus = "new" | "investigating" | "resolved" | "ignored";

/** One dependency's current health check. */
export interface OpsServiceCheck {
  service: string;
  status: ServiceStatus;
  responseTimeMs: number | null;
  detail: string;
}

/** Rolled-up service status counts. */
export interface OpsOverall {
  status: ServiceStatus;
  healthy: number;
  degraded: number;
  down: number;
  unknown: number;
}

/** Headline health dashboard — GET /observability/summary. */
export interface OpsHealthDashboard {
  overall: OpsOverall;
  services: OpsServiceCheck[];
  metrics: {
    requestsTotal: number;
    errorsTotal: number;
    apiErrorRatePct: number;
    avgResponseMs: number;
    byStatusClass: Record<string, number>;
    queueDepth: number;
    pendingJobs: number;
    runningJobs: number;
    failedJobsToday: number;
    stuckJobs: number;
  };
  incidents: { active: number; critical: number };
  alerts: {
    open: number;
    recent: Array<
      Pick<Alert, "id" | "ruleName" | "type" | "severity" | "status" | "service" | "triggeredAt">
    >;
  };
  uptime: {
    windowChecks: number;
    healthyChecks: number;
    since: string | null;
    note: string;
  };
  backupStorage: {
    lastSuccessAt: string | null;
    failed: number;
    storageUsedBytes: number;
  };
  deploy: { lastDeployAt: string | null; note: string };
}

/** GET /observability/services and POST /observability/services/run. */
export interface OpsServiceList {
  overall: OpsOverall;
  services: OpsServiceCheck[];
}

/** One health-history row for a service. */
export interface OpsServiceHistoryEntry {
  status: ServiceStatus;
  responseTimeMs: number | null;
  detail: string;
  checkedAt: string;
}

/** GET /observability/services/:name. */
export interface OpsServiceDetail {
  service: string;
  current: OpsServiceCheck;
  uptimePct: number | null;
  counts: { total: number; healthy: number; degraded: number; down: number };
  history: OpsServiceHistoryEntry[];
}

/** Per-service uptime aggregate. */
export interface OpsUptimeService {
  service: string;
  total: number;
  healthy: number;
  degraded: number;
  down: number;
  unknown: number;
  avgResponseMs: number | null;
  lastCheckedAt: string | null;
  uptimePct: number | null;
}

/** A recent degraded/down window. */
export interface OpsUptimePeriod {
  service: string;
  status: ServiceStatus;
  detail: string;
  checkedAt: string;
}

/** GET /observability/uptime?window=. */
export interface OpsUptime {
  window: "24h" | "7d" | "30d";
  services: OpsUptimeService[];
  degradedPeriods: OpsUptimePeriod[];
  sparse: boolean;
  note: string;
}

/** One route's request stats (avg + p95). */
export interface OpsRouteStat {
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

/** GET /observability/performance. */
export interface OpsPerformance {
  requests: {
    total: number;
    errors: number;
    errorRatePct: number;
    avgResponseMs: number;
    byStatusClass: Record<string, number>;
  };
  perRoute: OpsRouteStat[];
  slowRoutes: OpsRouteStat[];
  note: string;
}

/** Per-tenant document storage vs the plan limit. */
export interface OpsTenantStorage {
  institutionId: string;
  institutionName: string;
  institutionCode: string;
  documents: number;
  usedBytes: number;
  usedMb: number;
  limitMb: number | null;
  usagePct: number | null;
  nearLimit: boolean;
  overLimit: boolean;
}

/** GET /observability/storage. */
export interface OpsStorage {
  totalBytes: number;
  byCategory: { backups: number; exports: number; documents: number };
  documentCategories: Array<{ category: string; bytes: number; count: number }>;
  documentCount: number;
  storageMode: string;
  byTenant: OpsTenantStorage[];
  nearOrOverLimit: OpsTenantStorage[];
  largestTenants: OpsTenantStorage[];
}

/** GET /observability/smtp. */
export interface OpsSmtpHealth {
  configured: boolean;
  status: "healthy" | "degraded" | "unknown";
  verified: boolean;
  delivery: {
    sent: number;
    failed: number;
    skipped: number;
    failureRatePct: number;
  };
  recentFailedRecipients: Array<{
    recipient: string;
    template: string;
    createdAt: string;
  }>;
  note: string;
}

/** GET /observability/jobs-health. */
export interface OpsJobsHealth {
  queue: {
    pending: number;
    running: number;
    success: number;
    failed: number;
    cancelled: number;
  };
  stuck: number;
  failedTrend: Array<{ day: string; count: number }>;
  processed: { success: number; failed: number; retried: number };
  workerEnabled: boolean;
  link: string;
}

/** GET /observability/integrations. Each card can be {unavailable:true}. */
export interface OpsIntegrations {
  backups:
    | {
        lastSuccessAt: string | null;
        available: number;
        failed: number;
        storageUsedBytes: number;
        warnings: number;
      }
    | { unavailable: true };
  exports:
    | {
        total: number;
        pendingApproval: number;
        sensitive: number;
        storageUsedBytes: number;
      }
    | { unavailable: true };
  security: { alerts: number; critical: number };
  audit: { last24h: number; highRisk24h: number };
  links: { backups: string; exports: string; security: string; audit: string };
}

/** GET /observability/logs — masked recent error + audit rows. */
export interface OpsLogsSummary {
  source: "errors" | "audit" | "all";
  errors: Array<{
    id: string;
    route: string;
    method: string;
    statusCode: number;
    errorType: string | null;
    message: string | null;
    status: string;
    count: number;
    lastSeen: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    actorEmail: string | null;
    actorRole: string | null;
    targetType: string | null;
    ip: string | null;
    createdAt: string;
  }>;
}

/** A tracked incident (append-only lifecycle — never hard-deleted). */
export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  type: IncidentType;
  impact: string | null;
  rootCause: string | null;
  resolution: string | null;
  ownerId: string | null;
  relatedAlertId: string | null;
  relatedAuditId?: string | null;
  startedAt: string;
  resolvedAt: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on GET /observability/incidents/:id. */
  timeline?: IncidentEvent[];
}

/** One entry in an incident's append-only timeline. */
export interface IncidentEvent {
  id: string;
  kind: string;
  note: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  createdAt: string;
}

/** GET /observability/incidents (paginated). */
export interface IncidentListResult {
  rows: Incident[];
  total: number;
  page: number;
  pageSize: number;
}

/** A configured alert rule. */
export interface AlertRule {
  id: string;
  name: string;
  type: AlertRuleType;
  threshold: number | null;
  windowMinutes: number;
  severity: IncidentSeverity;
  enabled: boolean;
  notifyTarget: string | null;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A durable alert-feed row (ack/resolve/link/note are transitions). */
export interface Alert {
  id: string;
  ruleId: string | null;
  ruleName: string;
  type: string;
  severity: IncidentSeverity;
  status: AlertStatus;
  service: string | null;
  metricValue: number | null;
  threshold: number | null;
  details: Record<string, unknown> | null;
  incidentId: string | null;
  note: string | null;
  triggeredAt: string;
  acknowledgedBy?: string | null;
  acknowledgedAt: string | null;
  resolvedBy?: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** GET /observability/alerts (paginated). */
export interface AlertListResult {
  rows: Alert[];
  total: number;
  page: number;
  pageSize: number;
}

/** A captured, de-duplicated error (message masked; never a stack/body). */
export interface ErrorEvent {
  id: string;
  fingerprint: string;
  route: string;
  method: string;
  statusCode: number;
  errorType: string | null;
  message: string | null;
  lastRequestId?: string | null;
  lastActorId?: string | null;
  lastInstitutionId?: string | null;
  status: ErrorTriageStatus;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

/** GET /observability/errors (paginated). */
export interface ErrorListResult {
  rows: ErrorEvent[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /observability/errors/summary. */
export interface ErrorSummary {
  window: "today" | "24h" | "7d" | "30d";
  totals: {
    distinctErrors: number;
    totalOccurrences: number;
    new: number;
    investigating: number;
    serverErrors: number;
    clientErrors: number;
  };
  byRoute: Array<{ route: string; distinct: number; occurrences: number }>;
  byStatusClass: Array<{ statusClass: string; occurrences: number }>;
}

// --- Super Admin J: Backup / Restore / DR hardening (/backups/*) ---

export type BackupStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "archived";
export type BackupTrigger =
  | "manual"
  | "scheduled"
  | "pre_deploy"
  | "pre_restore";
export type BackupChecksumStatus = "not_verified" | "verified" | "failed";
export type BackupFrequency = "daily" | "weekly" | "monthly";

/** A database backup (super-admin backup/restore/DR automation). */
export interface Backup {
  id: string;
  scope: "global" | "institution";
  institutionId: string | null;
  status: BackupStatus;
  trigger: BackupTrigger;
  storageMode: "s3" | "local" | null;
  sizeBytes: number | string | null; // bigint serialises as a string
  tableCount: number | null;
  rowCount: number | null;
  schemaVersion: number | null;
  error: string | null;
  logsSummary: string | null;
  checksum: string | null;
  checksumAlgo: string | null;
  checksumStatus: BackupChecksumStatus;
  checksumVerifiedAt: string | null;
  checksumVerifiedBy: string | null;
  offsite: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  hasArtifact: boolean;
  createdBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** Overview dashboard aggregate (GET /backups/summary). */
export interface BackupSummary {
  lastBackup: Backup | null;
  lastSuccessAt: string | null;
  lastSuccessSizeBytes: number | string | null;
  schedule: {
    enabled: boolean;
    frequency: BackupFrequency;
    runTime: string;
    nextRunAt: string | null;
  };
  retention: {
    retentionCount: number | null;
    retentionMinKeep: number | null;
  };
  totals: {
    total: number;
    available: number;
    archived: number;
    failed: number;
  };
  integrity: {
    checksumVerified: number;
    checksumFailed: number;
  };
  offsite: {
    mode: string;
    configured: boolean;
    copies: number;
    lastTestAt: string | null;
    lastTestOk: boolean | null;
  };
  encryption: { enabled: boolean };
  storageUsedBytes: number | string | null;
  restore: {
    pendingRequests: number;
    latestStatus: string | null;
    latestAt: string | null;
  };
  warnings: string[];
}

export interface BackupSettings {
  retentionCount: number | null;
  retentionMinKeep: number | null;
  scheduleEnabled: boolean;
  scheduleFrequency: BackupFrequency;
  scheduleRunTime: string;
  nextRunAt: string | null;
  offsiteEnabled: boolean;
  lastOffsiteTestAt: string | null;
  lastOffsiteTestOk: boolean | null;
  lastOffsiteTestDetail: string | null;
  encryptionEnabled: boolean;
  failureAlertEnabled: boolean;
  alertEmails: string | null;
  updatedAt: string;
}

/** Paginated backup history (GET /backups/history). */
export interface BackupHistoryPage {
  rows: Backup[];
  total: number;
  page: number;
  pageSize: number;
}

/** Off-site replication status (GET /backups/offsite). Never carries secrets. */
export interface OffsiteStatus {
  mode: "s3" | "local";
  target: string | null;
  configured: boolean;
  endpointHost: string | null;
  bucket: string | null;
  syncStatus: "synced" | "failed" | "not_configured";
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestDetail: string | null;
  note: string | null;
}

/** At-rest encryption posture (GET /backups/encryption) — documented limitation. */
export interface EncryptionStatus {
  implemented: false;
  status: "not_enabled";
  algorithm: string | null;
  keyManagement: string | null;
  atRestAcknowledged: boolean;
  warning: string;
}

/** Editable disaster-recovery runbook (GET/PATCH /backups/dr-guide). */
export interface DrGuide {
  policySummary: string | null;
  restoreProcess: string | null;
  approvalProcess: string | null;
  emergencyInstructions: string | null;
  preRestoreChecklist: string | null;
  postRestoreChecklist: string | null;
  rollbackGuide: string | null;
  ownerName: string | null;
  ownerContact: string | null;
  sopLink: string | null;
  lastReviewedAt: string | null;
  updatedAt: string;
}

/** Restore feasibility check (GET /backups/:id/restore/preview). */
export interface RestorePreview {
  backupId: string;
  scope: string;
  createdAt: string;
  schemaVersion: number;
  currentSchemaVersion: number;
  schemaMatches: boolean;
  checksumStatus: BackupChecksumStatus;
  restorable: boolean;
  tableCount: number;
  totalRows: number;
  tables: { name: string; rowCount: number }[];
  impact: {
    overwritesAllData: boolean;
    downtimeRisk: string;
    recommendPreRestoreBackup: boolean;
  };
}

export type RestoreRequestScope = "full" | "database" | "files" | "config";
export type RestoreRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "executed"
  | "failed";

/** Impact preview snapshot stored on a restore request. */
export interface RestoreImpactPreview {
  overwritesAllData?: boolean;
  downtimeRisk?: string;
  recommendPreRestoreBackup?: boolean;
  tableCount?: number;
  totalRows?: number;
  tables?: { name: string; rowCount: number }[];
  [key: string]: unknown;
}

/** A governed, approval-gated restore request (GET /backups/restore-requests). */
export interface RestoreRequest {
  id: string;
  backupId: string;
  backupScope: string;
  backupCreatedAt: string | null;
  backupChecksumStatus: BackupChecksumStatus | null;
  scope: RestoreRequestScope;
  reason: string | null;
  riskReason: string | null;
  impactPreview: RestoreImpactPreview | null;
  status: RestoreRequestStatus;
  requestedBy: string | null;
  requestedByEmail: string | null;
  decidedBy: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  consumedAt: string | null;
  executedAt: string | null;
  executedBy: string | null;
  executedByEmail: string | null;
  executionResult: string | null;
  executionDetail: string | null;
  preRestoreBackupId: string | null;
  expiresAt: string | null;
  createdAt: string;
  confirmPhrase: string | null;
}

/** Paginated restore-request list (GET /backups/restore-requests). */
export interface RestoreRequestPage {
  rows: RestoreRequest[];
  total: number;
  page: number;
  pageSize: number;
}

// --- Live Classes ---

export type LiveClassProvider = "zoom" | "meet" | "teams" | "jitsi" | "other";

export type LiveClassStatus = "scheduled" | "live" | "completed" | "cancelled";

export interface LiveClass {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  target: string | null;
  provider: LiveClassProvider;
  joinUrl: string;
  hostName: string | null;
  scheduledAt: string;
  durationMin: number;
  status: LiveClassStatus;
  createdAt: string;
}

// --- Super Admin G: Support Access Hardening (/platform/support/*) ---

/** A support session's access scope. */
export type SupportScope = "read_only" | "write_enabled" | "module_limited";

/** A support session's lifecycle status. */
export type SupportStatus = "active" | "ended" | "expired" | "revoked" | "failed";

/**
 * One governed support-access session (POST/GET /platform/support/sessions...).
 * `endedByEmail`/`revokedByEmail` are only populated by GET /sessions/:id.
 */
export interface SupportSession {
  id: string;
  operatorId: string | null;
  operatorEmail: string | null;
  operatorName: string | null;
  targetId: string;
  targetEmail: string;
  targetRole: string;
  institutionId: string | null;
  institutionName: string | null;
  institutionCode: string | null;
  scope: SupportScope;
  allowedModules: string[];
  status: SupportStatus;
  reason: string | null;
  reasonTemplate: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Phase 2 (I): tenant-notification delivery outcome for this session. */
  notifyStatus: SupportNotifyStatus | null;
  notifyDetail: SupportNotifyDetail | null;
  startedAt: string;
  expiresAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  durationMinutes: number | null;
  endedByEmail?: string | null;
  revokedByEmail?: string | null;
}

/** Paginated session history (GET /platform/support/sessions). */
export interface SupportSessionPage {
  rows: SupportSession[];
  total: number;
  page: number;
  pageSize: number;
}

/** Per-operator session counts in the summary. */
export interface SupportSummaryOperator {
  operatorId: string | null;
  operatorEmail: string | null;
  sessions: number;
}

/** Per-tenant session counts in the summary. */
export interface SupportSummaryTenant {
  institutionId: string | null;
  institutionName: string | null;
  institutionCode: string | null;
  sessions: number;
}

/** A support-related platform-audit event surfaced on the Overview. */
export interface SupportAuditEvent {
  id: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  targetId: string | null;
  institutionId: string | null;
  detail: unknown;
  createdAt: string;
}

/** Dashboard cards over a window (GET /platform/support/summary). */
export interface SupportSummary {
  window: "today" | "7d" | "30d" | "custom";
  activeCount: number;
  startedToday: number;
  endedToday: number;
  expiredToday: number;
  revokedToday: number;
  highRiskCount: number;
  avgDurationMinutes: number;
  byOperator: SupportSummaryOperator[];
  byTenant: SupportSummaryTenant[];
  nearingExpiry: SupportSession[];
  recentAuditEvents: SupportAuditEvent[];
}

/** Security-Center support posture (GET /platform/support/security-summary). */
export interface SupportSecuritySummary {
  activeCount: number;
  longRunningCount: number;
  recentlyRevoked: SupportSession[];
  highRisk: SupportSession[];
}

/** Static reference lists for the console dropdowns (GET /platform/support/templates). */
export interface SupportTemplates {
  templates: string[];
  modules: string[];
  scopes: string[];
}

/** POST /platform/support/sessions success payload (imp token + minimal session/user). */
export interface SupportStartResult {
  token: string;
  expiresAt: string;
  session: {
    id: string;
    scope: SupportScope;
    allowedModules: string[];
    status: SupportStatus;
    expiresAt: string;
  };
  user: {
    id: string;
    email: string;
    role: UserRole;
    institutionId: string | null;
    fullName: string;
  };
}

/**
 * The engaged-session context captured when an operator enters support mode.
 * Persisted (with the operator's own token) so the banner can render and the
 * session can be ended even across a page refresh.
 */
export interface SupportSessionContext {
  id: string;
  targetId: string;
  targetEmail: string;
  targetRole: string;
  targetName: string;
  institutionId: string | null;
  institutionName: string | null;
  institutionCode: string | null;
  scope: SupportScope;
  allowedModules: string[];
  reason: string;
  reasonTemplate: string | null;
  operatorEmail: string;
  expiresAt: string;
  startedAt: string;
}

/**
 * Support-mode overlay stashed in the auth store while an operator is
 * impersonating a tenant user. `null` whenever the operator is acting as
 * themselves — every support-related code path guards on this being non-null.
 */
export interface SupportModeState {
  operatorToken: string;
  operatorUser: User;
  session: SupportSessionContext;
}

// --- Super Admin G: Support Access — Phase 2 (reports, notifications, approvals) ---

/** Tenant-notification delivery outcome recorded on a support session. */
export type SupportNotifyStatus = "sent" | "failed" | "skipped";

/** One tenant-notification delivery event (per session phase). */
export interface SupportNotifyEvent {
  phase: "started" | "ended";
  status: SupportNotifyStatus;
  recipient: string | null;
  at: string;
  error?: string;
}

/**
 * The `notifyDetail` payload stored on a session (already secret-masked by the
 * server). Carries the latest phase outcome at the top level plus an `events`
 * trail. Never contains the issued token or any stored secret.
 */
export interface SupportNotifyDetail {
  recipient: string | null;
  at: string;
  phase: "started" | "ended";
  status: SupportNotifyStatus;
  error?: string;
  events?: SupportNotifyEvent[];
}

/** The ten support-access report datasets (the `type` query value). */
export type SupportReportType =
  | "all"
  | "active"
  | "expired"
  | "revoked"
  | "tenant-wise"
  | "operator-wise"
  | "reason-wise"
  | "scope-wise"
  | "long-running"
  | "high-risk";

/** Shared report/export filter set (mirrors the history filters, minus targetId). */
export interface SupportReportFilters {
  dateFrom?: string;
  dateTo?: string;
  institutionId?: string;
  operatorId?: string;
  status?: string;
  scope?: string;
  reasonTemplate?: string;
}

/** Stable totals over the filtered set (same for every report type of one filter). */
export interface SupportReportTotals {
  sessionCount: number;
  avgDurationMinutes: number;
  activeCount: number;
  revokedCount: number;
  expiredCount: number;
  notificationSentCount: number;
  notificationFailedCount: number;
}

/**
 * One aggregate row of a grouped report (tenant-/operator-/reason-/scope-wise).
 * Only the dimension keys for the requested type are populated; all groups share
 * the per-group aggregate counters.
 */
export interface SupportReportGroup {
  institutionId?: string | null;
  institutionName?: string | null;
  institutionCode?: string | null;
  operatorId?: string | null;
  operatorEmail?: string | null;
  operatorName?: string | null;
  reasonTemplate?: string | null;
  scope?: string | null;
  sessions: number;
  avgDurationMinutes: number;
  activeCount: number;
  revokedCount: number;
  expiredCount: number;
}

/**
 * A support-access report dataset (GET /platform/support/reports). Row-based
 * types return `rows` (masked session projections); grouped types return `groups`.
 */
export interface SupportReport {
  type: SupportReportType;
  filters: SupportReportFilters;
  totals: SupportReportTotals;
  rows?: SupportSession[];
  groups?: SupportReportGroup[];
}

/** An approval request's lifecycle status. */
export type SupportApprovalStatus = "pending" | "approved" | "rejected";

/**
 * A support-access approval request (GET/POST /platform/support/approvals). The
 * joined display fields (`*Email`, `institutionName/Code`) are present on the list
 * projection; the create/decide single-row projection omits them.
 */
export interface SupportApproval {
  id: string;
  requestedBy: string | null;
  requestedByEmail?: string | null;
  targetId: string;
  targetEmail?: string | null;
  institutionId: string | null;
  institutionName?: string | null;
  institutionCode?: string | null;
  reason: string | null;
  reasonTemplate: string | null;
  scope: SupportScope;
  allowedModules: string[];
  expiryMinutes: number;
  riskReason: string | null;
  status: SupportApprovalStatus;
  decidedBy: string | null;
  decidedByEmail?: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  consumedAt: string | null;
  consumedSessionId: string | null;
  createdAt: string;
}

/** Paginated approval list (GET /platform/support/approvals). */
export interface SupportApprovalPage {
  rows: SupportApproval[];
  total: number;
  page: number;
  pageSize: number;
}

// --- Super Admin K — Data Export Center ---
// Field lists mirror the backend `PUBLIC_SELECT`, `summary()` and the schema
// enums in backend/src/modules/exports/. The API NEVER returns storage paths /
// keys — only a `hasArtifact` boolean — so nothing here references a storage key.

export type ExportScope =
  | "institutions"
  | "platform_admins"
  | "tenant_users"
  | "invoices"
  | "subscriptions"
  | "packages"
  | "coupons"
  | "payments"
  | "audit_logs"
  | "security_reports"
  | "support_history"
  | "backup_metadata"
  | "documents_metadata"
  | "students"
  | "staff"
  | "fees"
  | "attendance"
  | "exams"
  | "portability_pack";

export type ExportFormat = "csv" | "xlsx" | "json" | "zip";

export type ExportStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

export type ExportApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export type ExportScheduleFrequency = "daily" | "weekly" | "monthly";

/** One export row (GET /exports, GET /exports/:id) — masked, no storage key. */
export interface PlatformExport {
  id: string;
  name: string;
  scope: ExportScope;
  format: ExportFormat;
  institutionId: string | null;
  filters: Record<string, unknown> | null;
  reason: string | null;
  sensitive: boolean;
  status: ExportStatus;
  approvalStatus: ExportApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalReason: string | null;
  storageMode: string | null;
  sizeBytes: number | null;
  rowCount: number | null;
  fileCount: number | null;
  checksum: string | null;
  checksumAlgo: string | null;
  error: string | null;
  expiresAt: string | null;
  downloadCount: number;
  lastDownloadedBy: string | null;
  lastDownloadedAt: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  scheduleId: string | null;
  requestedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  hasArtifact: boolean;
}

/** Paginated export history (GET /exports). */
export interface ExportPage {
  rows: PlatformExport[];
  total: number;
  page: number;
  pageSize: number;
}

/** One recent export audit event (from ExportSummary.recentEvents). */
export interface ExportAuditEvent {
  action: string;
  actorEmail: string | null;
  targetId: string | null;
  createdAt: string;
}

/** Dashboard summary (GET /exports/summary). */
export interface ExportSummary {
  totals: {
    total: number;
    completed: number;
    running: number;
    pending: number;
    failed: number;
    expired: number;
    cancelled: number;
  };
  today: number;
  sensitive: number;
  pendingApproval: number;
  portabilityPacks: number;
  nearingExpiry: number;
  storageUsedBytes: number;
  downloads: number;
  latestStatus: ExportStatus | null;
  schedules: { total: number; enabled: number };
  recentEvents: ExportAuditEvent[];
}

/** One scheduled export (GET/POST/PATCH /exports/schedules). */
export interface ExportSchedule {
  id: string;
  name: string;
  scope: ExportScope;
  format: ExportFormat;
  institutionId: string | null;
  filters: Record<string, unknown> | null;
  frequency: ExportScheduleFrequency;
  runTime: string;
  enabled: boolean;
  reason: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastExportId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Paginated schedule list (GET /exports/schedules). */
export interface ExportSchedulePage {
  rows: ExportSchedule[];
  total: number;
  page: number;
  pageSize: number;
}

/** Export retention defaults (GET/PATCH /exports/retention). */
export interface ExportRetention {
  defaultRetentionDays: number;
  sensitiveRetentionDays: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

// --- Super Admin M — Background Jobs Console / Queue Governance (/jobs-ops/*) ---
//
// The composed Background Jobs views. Every timestamp is an ISO string; `null`
// wherever the FIXED backend contract (jobsops.service) returns null. The API
// masks every payload/error/result/reason — the UI only ever renders what it is
// given (no secrets, stacks, headers or bodies are ever emitted).

/** Persisted job statuses (mirrors jobs_status_check). */
export type JobOpsStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "dead_letter";

/** List/report filter statuses — persisted set plus the derived `stuck`. */
export type JobFilterStatus = JobOpsStatus | "stuck";

/** Per-attempt status (mirrors job_attempts.status CHECK). */
export type JobAttemptStatus =
  | "running"
  | "success"
  | "failed"
  | "retry"
  | "cancelled"
  | "dead_letter";

/** Derived worker liveness (from the heartbeat age). */
export type WorkerStatus = "online" | "degraded" | "offline" | "unknown";

/** Derived source-module buckets (SOURCE_MODULE in the service). */
export type SourceModule =
  | "Reports"
  | "Communication"
  | "Backup"
  | "Export"
  | "Integrations"
  | "Observability"
  | "System"
  | "Other";

/** Aggregated schedule source. */
export type ScheduleSource = "reports" | "backup" | "export" | "system";

/** Dashboard / reports time window. */
export type JobWindow = "today" | "24h" | "7d" | "30d" | "custom";

/** Job alert severity + status (reuses the Observability L alert store). */
export type JobAlertSeverity = IncidentSeverity;
export type JobAlertStatus = AlertStatus;

/** A recent job alert summary row on the dashboard. */
export interface JobAlertSummary {
  id: string;
  ruleName: string;
  type: string;
  severity: JobAlertSeverity;
  status: JobAlertStatus;
  service: string | null;
  triggeredAt: string;
}

/** GET /jobs-ops/summary — the ~20-metric queue dashboard. */
export interface JobsDashboard {
  window: JobWindow;
  statuses: {
    pending: number;
    running: number;
    success: number;
    failed: number;
    cancelled: number;
    dead_letter: number;
  };
  queueDepth: number;
  stuck: number;
  retriedInWindow: number;
  failedInWindow: number;
  failureRatePct: number;
  avgJobDurationMs: number;
  longestRunningJob: { id: string; type: string; startedAt: string | null; ageMs: number } | null;
  workers: { total: number; active: number };
  scheduler: { lastTickAt: string | null; status: string; note: string };
  jobsNeedingAttention: number;
  recentAlerts: JobAlertSummary[];
}

/** A related-entity reference surfaced on the detail view (opaque ids). */
export interface JobRelatedLink {
  type: string;
  id: string;
  key: string;
}

/** One row of the job list / dead-letter list (payload already masked). */
export interface JobRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobOpsStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  queue: string;
  runAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  deadLetteredAt: string | null;
  deadLetterReason: string | null;
  dedupeKey: string | null;
  institutionId: string | null;
  institutionName: string | null;
  institutionCode: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  sourceModule: SourceModule;
  stuck: boolean;
}

/** GET /jobs-ops/jobs and /dead-letter. */
export interface JobListResult {
  rows: JobRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** One append-only attempt row (masked error/result). */
export interface JobAttempt {
  id: string;
  attemptNumber: number;
  status: JobAttemptStatus;
  workerId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  retryReason: string | null;
  backoffMs: number | null;
  nextRetryAt: string | null;
  resultSummary: string | null;
  createdAt: string;
}

/** One recent audit event on the job detail. */
export interface JobAuditEvent {
  id: string;
  action: string;
  actorEmail: string | null;
  actorRole: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** Per-type retry policy applied by the worker. */
export interface JobRetryPolicy {
  maxAttempts: number;
  backoffStrategy: string;
  backoffBaseMs: number;
  module: SourceModule;
  note: string;
}

/** GET /jobs-ops/jobs/:id — the full masked detail. NOTE: the backend response
 *  overrides the numeric `attempts` counter with the attempt array, so on the
 *  detail `attempts` is the timeline (use `attempts.length` for the count). */
export interface JobDetail extends Omit<JobRow, "attempts"> {
  relatedLinks: JobRelatedLink[];
  attempts: JobAttempt[];
  recentAudit: JobAuditEvent[];
  retryPolicy: JobRetryPolicy;
}

/** GET /jobs-ops/jobs/:id/attempts. */
export interface JobAttemptsResult {
  rows: JobAttempt[];
}

/** POST /jobs-ops/bulk — per-id state rules; skipped carries the reason. */
export interface JobBulkResult {
  requested: number;
  affected: number;
  skipped: { id: string; reason: string }[];
}

/** One worker heartbeat with derived liveness. */
export interface WorkerHeartbeat {
  workerId: string;
  lastHeartbeatAt: string | null;
  currentJobId: string | null;
  jobsProcessed: number;
  jobsFailed: number;
  queue: string | null;
  hostname: string | null;
  version: string | null;
  firstSeenAt: string | null;
  updatedAt: string | null;
  status: WorkerStatus;
  lastHeartbeatAgeMs: number;
}

/** GET /jobs-ops/workers. */
export interface WorkersResult {
  workers: WorkerHeartbeat[];
  note: string;
}

/** One aggregated recurring schedule. */
export interface JobSchedule {
  source: ScheduleSource;
  id: string;
  name: string;
  jobType: string;
  frequency: string | null;
  enabled: boolean;
  status: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
  institutionName?: string | null;
  critical: boolean;
  note?: string;
}

/** GET /jobs-ops/schedules. */
export interface JobSchedulesResult {
  schedules: JobSchedule[];
}

/** POST /jobs-ops/process — on-demand worker drain. */
export interface JobProcessResult {
  processed: number;
  success: number;
  failed: number;
  retried: number;
}

/** POST /jobs-ops/run-scheduler — schedule tick enqueue counts. */
export interface JobSchedulerRunResult {
  reports: number;
  backups: number;
  exports: number;
}

/** A job/worker/scheduler alert row (reuses the L store; note masked). */
export interface JobAlert {
  id: string;
  ruleId: string | null;
  ruleName: string;
  type: string;
  severity: JobAlertSeverity;
  status: JobAlertStatus;
  service: string | null;
  metricValue: number | null;
  threshold: number | null;
  incidentId: string | null;
  note: string | null;
  triggeredAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** GET /jobs-ops/alerts (paginated). */
export interface JobAlertListResult {
  rows: JobAlert[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /jobs-ops/retry-policy — read-only summary. */
export interface RetryPolicySummary {
  default: {
    maxAttempts: number;
    backoffStrategy: string;
    backoffBaseMs: number;
    formula: string;
  };
  perType: Array<{
    type: string;
    module: SourceModule;
    minMaxAttempts: number;
    maxMaxAttempts: number;
    jobs: number;
  }>;
  note: string;
}

/** GET /jobs-ops/reports — the aggregate report bundle. */
export interface JobReports {
  window: JobWindow;
  volumeByType: Array<{ type: string; count: number }>;
  statusSummary: {
    pending: number;
    running: number;
    success: number;
    failed: number;
    cancelled: number;
    dead_letter: number;
  };
  failureReport: Array<{ type: string; failures: number }>;
  retryReport: Array<{ type: string; retries: number }>;
  deadLetterReport: Array<{ type: string; count: number }>;
  schedulerRunReport: Array<{ type: string; status: string; count: number }>;
  moduleWise: Array<{ module: string; count: number; failed: number }>;
  queueDepth: { pending: number; running: number; total: number };
  longRunningJobs: Array<{ id: string; type: string; startedAt: string | null; ageMs: number }>;
  workerPerformance: Array<{
    workerId: string;
    jobsProcessed: number;
    jobsFailed: number;
    lastHeartbeatAt: string | null;
    hostname: string | null;
    version: string | null;
  }>;
}

/** GET /jobs-ops/integrations — links to Observability / Audit / Security. */
export interface JobsIntegrations {
  observability:
    | {
        queue: {
          pending: number;
          running: number;
          success: number;
          failed: number;
          cancelled: number;
        };
        stuck: number;
        failedTrend: Array<{ day: string; count: number }>;
        processed: { success: number; failed: number; retried: number };
        workerEnabled: boolean;
      }
    | { unavailable: true };
  audit: { jobActions24h: number };
  security: { criticalJobAlerts: number };
  links: { observability: string; audit: string; security: string };
}
