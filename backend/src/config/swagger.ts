import path from "node:path";
import swaggerJsdoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "SRE EDU OS API",
      version: "0.1.0",
      description:
        "School ERP REST API — students, teachers, classes, attendance, " +
        "exams, fees, announcements and an AI assistant.",
    },
    servers: [{ url: "/api/v1", description: "API v1" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    tags: [
      { name: "Auth" },
      { name: "Users" },
      { name: "Students" },
      { name: "Teachers" },
      { name: "Academics" },
      { name: "Attendance" },
      { name: "Exams" },
      { name: "Fees" },
      { name: "Announcements" },
      { name: "Dashboard" },
      { name: "AI" },
    ],
  },
  // Glob covers both tsx (src/*.ts) and compiled (dist/*.js) execution.
  apis: [path.join(__dirname, "../modules/**/*.routes.{ts,js}")],
});
