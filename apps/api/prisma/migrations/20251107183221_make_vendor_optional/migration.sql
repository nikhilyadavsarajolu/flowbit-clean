-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_vendorId_fkey";

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "vendorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
