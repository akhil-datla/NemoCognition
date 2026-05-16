import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://nemocognition:nemocognition_dev@localhost:5432/nemocognition",
  },
});
