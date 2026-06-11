export type UserRole =
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
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
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
