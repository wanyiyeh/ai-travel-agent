-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "is_guest" BOOLEAN NOT NULL DEFAULT false,
    "disabled_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Itinerary" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "days" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Itinerary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "coords_fetched_at" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceQuery" (
    "query" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceQuery_pkey" PRIMARY KEY ("query")
);

-- CreateTable
CREATE TABLE "AccommodationCandidateLog" (
    "id" TEXT NOT NULL,
    "itinerary_id" TEXT NOT NULL,
    "day_id" TEXT NOT NULL,
    "candidates" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccommodationCandidateLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealCandidateLog" (
    "id" TEXT NOT NULL,
    "itinerary_id" TEXT NOT NULL,
    "day_id" TEXT NOT NULL,
    "meal_type" TEXT NOT NULL,
    "candidates" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealCandidateLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopCandidateLog" (
    "id" TEXT NOT NULL,
    "itinerary_id" TEXT NOT NULL,
    "day_id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,
    "candidates" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StopCandidateLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedStop" (
    "id" TEXT NOT NULL,
    "itinerary_id" TEXT NOT NULL,
    "day_id" TEXT NOT NULL,
    "day_number" INTEGER NOT NULL,
    "original_index" INTEGER NOT NULL,
    "stop" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedDay" (
    "id" TEXT NOT NULL,
    "itinerary_id" TEXT NOT NULL,
    "original_index" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransitRecommendationCache" (
    "originIata" TEXT NOT NULL,
    "destinationIata" TEXT NOT NULL,
    "recommendations" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransitRecommendationCache_pkey" PRIMARY KEY ("originIata","destinationIata")
);

-- CreateTable
CREATE TABLE "AirportRecommendationCache" (
    "iata" TEXT NOT NULL,
    "recommendations" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirportRecommendationCache_pkey" PRIMARY KEY ("iata")
);

-- CreateTable
CREATE TABLE "ItineraryRecommendationCache" (
    "itineraryId" TEXT NOT NULL,
    "originIata" TEXT NOT NULL,
    "destinationIata" TEXT NOT NULL,
    "recommendations" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItineraryRecommendationCache_pkey" PRIMARY KEY ("itineraryId","originIata","destinationIata")
);

-- CreateTable
CREATE TABLE "ClimateNormalCache" (
    "cacheKey" TEXT NOT NULL,
    "avgMaxTempC" DOUBLE PRECISION NOT NULL,
    "avgSnowDepthM" DOUBLE PRECISION NOT NULL,
    "rainyDayShare" DOUBLE PRECISION,
    "sunsetFirstMinute" INTEGER,
    "sunsetLastMinute" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClimateNormalCache_pkey" PRIMARY KEY ("cacheKey")
);

-- CreateTable
CREATE TABLE "SeasonalHighlightCache" (
    "cacheKey" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonalHighlightCache_pkey" PRIMARY KEY ("cacheKey")
);

-- CreateTable
CREATE TABLE "ClassicDayTripCache" (
    "city" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassicDayTripCache_pkey" PRIMARY KEY ("city")
);

-- CreateTable
CREATE TABLE "FilmLocationCache" (
    "cacheKey" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilmLocationCache_pkey" PRIMARY KEY ("cacheKey")
);

-- CreateTable
CREATE TABLE "CityCenterMissCache" (
    "cityName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityCenterMissCache_pkey" PRIMARY KEY ("cityName")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "user_id" TEXT,
    "is_guest" BOOLEAN NOT NULL DEFAULT false,
    "ip_hash" TEXT NOT NULL,
    "device_id" TEXT,
    "itinerary_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMeasurement" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "google" TEXT NOT NULL,
    "google_total" INTEGER NOT NULL,
    "openai_calls" INTEGER NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AccommodationCandidateLog_itinerary_id_day_id_idx" ON "AccommodationCandidateLog"("itinerary_id", "day_id");

-- CreateIndex
CREATE INDEX "MealCandidateLog_itinerary_id_day_id_meal_type_idx" ON "MealCandidateLog"("itinerary_id", "day_id", "meal_type");

-- CreateIndex
CREATE INDEX "StopCandidateLog_itinerary_id_day_id_stop_id_idx" ON "StopCandidateLog"("itinerary_id", "day_id", "stop_id");

-- CreateIndex
CREATE INDEX "DeletedStop_itinerary_id_idx" ON "DeletedStop"("itinerary_id");

-- CreateIndex
CREATE INDEX "DeletedDay_itinerary_id_idx" ON "DeletedDay"("itinerary_id");

-- CreateIndex
CREATE INDEX "UsageEvent_kind_created_at_idx" ON "UsageEvent"("kind", "created_at");

-- CreateIndex
CREATE INDEX "UsageEvent_user_id_kind_created_at_idx" ON "UsageEvent"("user_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "UsageEvent_ip_hash_kind_created_at_idx" ON "UsageEvent"("ip_hash", "kind", "created_at");

-- CreateIndex
CREATE INDEX "UsageEvent_device_id_kind_created_at_idx" ON "UsageEvent"("device_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "UsageEvent_itinerary_id_kind_idx" ON "UsageEvent"("itinerary_id", "kind");

-- CreateIndex
CREATE INDEX "UsageMeasurement_label_created_at_idx" ON "UsageMeasurement"("label", "created_at");

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceQuery" ADD CONSTRAINT "PlaceQuery_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccommodationCandidateLog" ADD CONSTRAINT "AccommodationCandidateLog_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealCandidateLog" ADD CONSTRAINT "MealCandidateLog_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopCandidateLog" ADD CONSTRAINT "StopCandidateLog_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletedStop" ADD CONSTRAINT "DeletedStop_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletedDay" ADD CONSTRAINT "DeletedDay_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryRecommendationCache" ADD CONSTRAINT "ItineraryRecommendationCache_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
