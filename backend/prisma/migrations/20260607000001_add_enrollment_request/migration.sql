-- CreateTable
CREATE TABLE "EnrollmentRequest" (
    "id"          TEXT NOT NULL,
    "hostname"    TEXT,
    "agentIp"     TEXT NOT NULL,
    "csr"         TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt"  TIMESTAMP(3),
    "reviewedBy"  TEXT,
    "cert"        TEXT,

    CONSTRAINT "EnrollmentRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_reviewedBy_fkey"
    FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
