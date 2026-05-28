-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('active', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "category" TEXT,
    "start_time" TIMESTAMPTZ NOT NULL,
    "end_time" TIMESTAMPTZ,
    "status" "event_status" NOT NULL DEFAULT 'active',
    "recurrence_rule" JSONB,
    "parent_id" UUID,
    "is_exception" BOOLEAN NOT NULL DEFAULT false,
    "exception_date" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "cancelled_at" TIMESTAMPTZ,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_event_links" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,

    CONSTRAINT "task_event_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_start_time_idx" ON "events"("start_time");

-- CreateIndex
CREATE INDEX "events_parent_id_idx" ON "events"("parent_id");

-- CreateIndex
CREATE INDEX "task_event_links_task_id_idx" ON "task_event_links"("task_id");

-- CreateIndex
CREATE INDEX "task_event_links_event_id_idx" ON "task_event_links"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_event_links_task_id_event_id_key" ON "task_event_links"("task_id", "event_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_event_links" ADD CONSTRAINT "task_event_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_event_links" ADD CONSTRAINT "task_event_links_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
