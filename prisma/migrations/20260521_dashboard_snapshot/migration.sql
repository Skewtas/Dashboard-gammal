-- CreateTable
CREATE TABLE "dashboard_snapshots" (
    "key" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,
    "refreshing" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dashboard_snapshots_pkey" PRIMARY KEY ("key")
);

