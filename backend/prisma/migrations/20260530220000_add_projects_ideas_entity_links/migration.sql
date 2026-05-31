-- CreateEnum: project_status
CREATE TYPE "project_status" AS ENUM ('active', 'paused', 'completed', 'cancelled');

-- CreateEnum: idea_status
CREATE TYPE "idea_status" AS ENUM ('new_idea', 'evaluating', 'approved', 'discarded', 'converted');

-- CreateEnum: entity_type
CREATE TYPE "entity_type" AS ENUM ('task', 'objective', 'project', 'idea', 'list', 'event');

-- DropTable: task_event_links
DROP TABLE "task_event_links";

-- CreateTable: projects
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "project_status" NOT NULL DEFAULT 'active',
    "category" TEXT,
    "deadline" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "cancelled_at" TIMESTAMPTZ,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ideas
CREATE TABLE "ideas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "idea_status" NOT NULL DEFAULT 'new_idea',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable: entity_links
CREATE TABLE "entity_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_type" "entity_type" NOT NULL,
    "source_id" UUID NOT NULL,
    "target_type" "entity_type" NOT NULL,
    "target_id" UUID NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'related',
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entity_links_source_type_source_id_idx" ON "entity_links"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "entity_links_target_type_target_id_idx" ON "entity_links"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_links_source_type_source_id_target_type_target_id_key" ON "entity_links"("source_type", "source_id", "target_type", "target_id");
