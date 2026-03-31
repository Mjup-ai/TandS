ALTER TABLE "RawEmail" ADD COLUMN "ccAddr" TEXT;
ALTER TABLE "RawEmail" ADD COLUMN "deliveredToAddr" TEXT;
ALTER TABLE "RawEmail" ADD COLUMN "originalRecipient" TEXT;
ALTER TABLE "RawEmail" ADD COLUMN "salesOwnerEmail" TEXT;
ALTER TABLE "RawEmail" ADD COLUMN "salesOwnerName" TEXT;
ALTER TABLE "RawEmail" ADD COLUMN "aiModel" TEXT;
ALTER TABLE "RawEmail" ADD COLUMN "aiJson" TEXT;
ALTER TABLE "RawEmail" ADD COLUMN "aiConfidence" REAL;
ALTER TABLE "RawEmail" ADD COLUMN "aiExtractedAt" DATETIME;

ALTER TABLE "ProjectOffer" ADD COLUMN "senderDomain" TEXT;
ALTER TABLE "ProjectOffer" ADD COLUMN "salesOwnerEmail" TEXT;
ALTER TABLE "ProjectOffer" ADD COLUMN "salesOwnerName" TEXT;
ALTER TABLE "ProjectOffer" ADD COLUMN "nationalityRequirement" TEXT;

ALTER TABLE "TalentOffer" ADD COLUMN "senderDomain" TEXT;
ALTER TABLE "TalentOffer" ADD COLUMN "salesOwnerEmail" TEXT;
ALTER TABLE "TalentOffer" ADD COLUMN "salesOwnerName" TEXT;
ALTER TABLE "TalentOffer" ADD COLUMN "employmentTypeText" TEXT;
ALTER TABLE "TalentOffer" ADD COLUMN "nationalityText" TEXT;

CREATE TABLE "GoogleAuth" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiryDateMs" BIGINT,
    "scope" TEXT,
    "tokenType" TEXT,
    "lastSyncedAt" DATETIME,
    "lastHistoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
