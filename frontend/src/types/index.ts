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
