import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

export const createVehicleSchema = z.object({
  registrationNo: z.string().min(1).max(40),
  type: z.string().max(60).nullish(),
  capacity: z.coerce.number().int().min(0).max(200).nullish(),
  insuranceExpiry: date.nullish(),
  fitnessExpiry: date.nullish(),
  permitExpiry: date.nullish(),
  isActive: z.boolean().optional(),
});
export const updateVehicleSchema = createVehicleSchema.partial();

export const createDriverSchema = z.object({
  name: z.string().min(1).max(160),
  phone: z.string().max(40).nullish(),
  licenseNumber: z.string().max(60).nullish(),
  licenseExpiry: date.nullish(),
  helperName: z.string().max(160).nullish(),
  helperPhone: z.string().max(40).nullish(),
  isActive: z.boolean().optional(),
});
export const updateDriverSchema = createDriverSchema.partial();

export const createRouteSchema = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(40),
  vehicleId: z.string().uuid().nullish(),
  driverId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});
export const updateRouteSchema = createRouteSchema.partial();

export const createStopSchema = z.object({
  name: z.string().min(1).max(160),
  stopOrder: z.coerce.number().int().min(0).max(1000).optional(),
  pickupTime: time.nullish(),
  dropTime: time.nullish(),
  distanceKm: z.coerce.number().min(0).max(100000).nullish(),
  zone: z.string().max(60).nullish(),
});
export const updateStopSchema = createStopSchema.partial();

export const createAllocationSchema = z.object({
  studentId: z.string().uuid(),
  routeId: z.string().uuid(),
  stopId: z.string().uuid().nullish(),
  tripType: z.enum(["pickup", "drop", "both"]).optional(),
  effectiveDate: date.optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export const updateAllocationSchema = z.object({
  routeId: z.string().uuid().optional(),
  stopId: z.string().uuid().nullish(),
  tripType: z.enum(["pickup", "drop", "both"]).optional(),
  effectiveDate: date.optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const setFeeSchema = z.object({
  routeId: z.string().uuid(),
  stopId: z.string().uuid().nullish(),
  amount: z.coerce.number().min(0).max(10_000_000),
  frequency: z.enum(["monthly", "term", "annual"]).optional(),
});

export const generateInvoicesSchema = z.object({
  routeId: z.string().uuid().optional(),
  dueDate: date,
  period: z.string().min(1).max(40),
  description: z.string().max(200).optional(),
});

export const createTripSchema = z.object({
  routeId: z.string().uuid(),
  tripDate: date,
  tripType: z.enum(["pickup", "drop"]),
  vehicleId: z.string().uuid().nullish(),
  driverId: z.string().uuid().nullish(),
  status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
});
export const updateTripSchema = z.object({
  vehicleId: z.string().uuid().nullish(),
  driverId: z.string().uuid().nullish(),
  status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
});
