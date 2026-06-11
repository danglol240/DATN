-- CreateTable
CREATE TABLE "EnrollmentCode" (
    "code"            TEXT NOT NULL,
    "createdBy"       TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"       TIMESTAMP(3) NOT NULL,
    "used"            BOOLEAN NOT NULL DEFAULT false,
    "usedAt"          TIMESTAMP(3),
    "usedByHostname"  TEXT,

    CONSTRAINT "EnrollmentCode_pkey" PRIMARY KEY ("code")
);

-- AddForeignKey
ALTER TABLE "EnrollmentCode" ADD CONSTRAINT "EnrollmentCode_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
