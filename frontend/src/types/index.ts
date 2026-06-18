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
  address: string | null;
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

export interface AccountUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  phone: string | null;
  isActive: boolean;
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
