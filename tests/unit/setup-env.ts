import "dotenv/config";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://ensemble:ensemble@localhost:5432/ensemble_test";
