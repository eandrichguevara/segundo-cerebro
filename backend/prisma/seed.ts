import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seed(): Promise<void> {
  console.log("Seeding database...");
  // Fase 1: sin datos iniciales necesarios.
  // Los enums ya están definidos en el schema.
  console.log("Seed completed.");
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
