-- CreateTable
CREATE TABLE "RawEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT,
    "receivedAt" DATETIME NOT NULL,
    "fromAddr" TEXT NOT NULL,
    "toAddr" TEXT,
    "subject" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "classification" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "RawAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawEmailId" TEXT NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "RawAttachment_rawEmailId_fkey" FOREIGN KEY ("rawEmailId") REFERENCES "RawEmail" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RawLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawEmailId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "linkType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RawLink_rawEmailId_fkey" FOREIGN KEY ("rawEmailId") REFERENCES "RawEmail" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawEmailId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IngestEvent_rawEmailId_fkey" FOREIGN KEY ("rawEmailId") REFERENCES "RawEmail" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT
);

-- CreateTable
CREATE TABLE "SkillAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    CONSTRAINT "SkillAlias_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillUpdateLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT,
    "action" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "EmploymentType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT,
    "canonicalName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Talent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProjectOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "partnerId" TEXT,
    "rawEmailId" TEXT,
    "priceMin" REAL,
    "priceMax" REAL,
    "paymentTerms" TEXT,
    "supplyChainDepth" INTEGER,
    "interviewCount" INTEGER,
    "requiredSkillIds" TEXT,
    "optionalSkillIds" TEXT,
    "workLocation" TEXT,
    "remoteOk" BOOLEAN,
    "availability" TEXT,
    "startPeriod" TEXT,
    "duration" TEXT,
    "conditions" TEXT,
    "confidenceFlags" TEXT,
    "extractedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectOffer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectOffer_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProjectOffer_rawEmailId_fkey" FOREIGN KEY ("rawEmailId") REFERENCES "RawEmail" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TalentOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "talentId" TEXT NOT NULL,
    "partnerId" TEXT,
    "rawEmailId" TEXT,
    "hopePriceMin" REAL,
    "hopePriceMax" REAL,
    "age" INTEGER,
    "employmentTypeId" TEXT,
    "nearestStationId" TEXT,
    "workLocationPreference" TEXT,
    "skillIdsWithYears" TEXT,
    "availability" TEXT,
    "startAvailableDate" TEXT,
    "skillSheetUrl" TEXT,
    "skillSheetAttachmentId" TEXT,
    "confidenceFlags" TEXT,
    "extractedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TalentOffer_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Talent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TalentOffer_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TalentOffer_rawEmailId_fkey" FOREIGN KEY ("rawEmailId") REFERENCES "RawEmail" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectOfferId" TEXT NOT NULL,
    "talentOfferId" TEXT NOT NULL,
    "score" INTEGER,
    "scoreBreakdown" TEXT,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "hardFilterFailed" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "recommendationReasons" TEXT,
    "attentionPoint" TEXT,
    "confirmationQuestions" TEXT,
    "emailDraft" TEXT,
    "callMemo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "outcomeReason" TEXT,
    "outcomeNotes" TEXT,
    "outcomeAt" DATETIME,
    "outcomeBy" TEXT,
    CONSTRAINT "Match_projectOfferId_fkey" FOREIGN KEY ("projectOfferId") REFERENCES "ProjectOffer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_talentOfferId_fkey" FOREIGN KEY ("talentOfferId") REFERENCES "TalentOffer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pipeline_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "RawEmail_messageId_key" ON "RawEmail"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_code_key" ON "Skill"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Station_code_key" ON "Station"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentType_code_key" ON "EmploymentType"("code");
