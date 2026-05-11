-- AlterTable
ALTER TABLE "Newsletter" ADD COLUMN     "parentNewsletterId" TEXT,
ADD COLUMN     "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reminderScheduledFor" TIMESTAMP(3),
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "reminderSubject" TEXT,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Newsletter" ADD CONSTRAINT "Newsletter_parentNewsletterId_fkey" FOREIGN KEY ("parentNewsletterId") REFERENCES "Newsletter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

