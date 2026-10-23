-- CreateTable
CREATE TABLE "RateLimitWindow" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimitWindow_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateTable
CREATE TABLE "DailyCallCount" (
    "service" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "DailyCallCount_pkey" PRIMARY KEY ("service","day")
);

-- CreateTable
CREATE TABLE "GenerationLock" (
    "key" TEXT NOT NULL,
    "lease" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationLock_pkey" PRIMARY KEY ("key")
);
