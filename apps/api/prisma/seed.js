
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

function toNumber(val) {
  if (val === null || val === undefined || val === "") return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

async function upsertVendorByName(name, category) {
  if (!name) return null;
  try {
    return await prisma.vendor.upsert({
      where: { name },
      update: { category: category || null },
      create: { name, category: category || null },
    });
  } catch (e) {
    console.error("vendor upsert err", e);
    return null;
  }
}

async function main() {
  const dataPath = path.join(process.cwd(), "../../data/Analytics_Test_Data.json");
  if (!fs.existsSync(dataPath)) {
    console.error("Data file not found:", dataPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(dataPath, "utf-8");
  let json = JSON.parse(raw);

  // If the JSON is top-level object with invoices array, try to normalize
  if (!Array.isArray(json) && json.invoices) {
    json = json.invoices;
  }

  
  for (const item of json) {
    if (item && item.invoices && item.name) {
      // shape: vendor objects with nested invoices
      const vendor = await upsertVendorByName(item.name, item.category);
      for (const inv of item.invoices || []) {
        const invoice = await prisma.invoice.create({
          data: {
            invoiceNo: inv.invoiceNo ?? inv.invoice_no ?? String(inv.id ?? Date.now()),
            date: inv.date ? new Date(inv.date) : new Date(),
            amount: toNumber(inv.amount ?? inv.invoiceTotal ?? 0),
            status: inv.status ?? "processed",
            vendorId: vendor ? vendor.id : undefined,
            createdAt: inv.createdAt ? new Date(inv.createdAt) : undefined,
          },
        });

        // line items
        if (inv.line_items || inv.lineItems || inv.items) {
          const items = inv.line_items ?? inv.lineItems ?? inv.items;
          for (const li of items) {
            await prisma.lineItem.create({
              data: {
                description: li.description ?? li.desc ?? "Item",
                quantity: parseInt(li.quantity ?? li.qty ?? 1),
                price: toNumber(li.price ?? li.unit_price ?? li.total ?? 0),
                invoiceId: invoice.id,
              },
            });
          }
        }

        // payments
        if (inv.payments) {
          for (const p of inv.payments) {
            await prisma.payment.create({
              data: {
                amount: toNumber(p.amount),
                date: p.date ? new Date(p.date) : new Date(),
                invoiceId: invoice.id,
              },
            });
          }
        }
      }
    } else {
      // shape: invoice objects
      const vendorName = (item.vendor && (item.vendor.name || item.vendor.vendorName)) || item.vendor_name || "Unknown Vendor";
      const vendorCategory = (item.vendor && item.vendor.category) || item.vendor?.vendorTaxId || null;
      const vendor = vendorName ? await upsertVendorByName(vendorName, vendorCategory) : null;

      const invoice = await prisma.invoice.create({
        data: {
          invoiceNo: item.invoice_no ?? item.invoiceNo ?? String(item.id ?? Date.now()),
          date: item.date ? new Date(item.date) : (item.extractedData?.llmData?.invoice?.value?.invoiceDate?.value ? new Date(item.extractedData.llmData.invoice.value.invoiceDate.value) : new Date()),
          amount: toNumber(item.amount ?? item.summary?.invoiceTotal?.value ?? item.extractedData?.llmData?.summary?.value?.invoiceTotal?.value ?? 0),
          status: item.status ?? "processed",
          vendorId: vendor ? vendor.id : undefined,
        },
      });

      // line items
      const liCandidates = item.line_items ?? item.lineItems ?? item.extractedData?.llmData?.lineItems?.value?.items?.value ?? item.items;
      if (Array.isArray(liCandidates)) {
        for (const li of liCandidates) {
          await prisma.lineItem.create({
            data: {
              description: li.description?.value ?? li.description ?? li.desc ?? "Item",
              quantity: parseInt(li.quantity?.value ?? li.quantity ?? li.qty ?? 1),
              price: toNumber(li.price?.value ?? li.price ?? li.unit_price ?? li.total ?? 0),
              invoiceId: invoice.id,
            },
          });
        }
      }

      // payments
      if (item.payments) {
        for (const p of item.payments) {
          await prisma.payment.create({
            data: {
              amount: toNumber(p.amount),
              date: p.date ? new Date(p.date) : new Date(),
              invoiceId: invoice.id,
            },
          });
        }
      } else if (item.extractedData?.llmData?.payment?.value) {
        const pay = item.extractedData.llmData.payment.value;
        if (pay && pay.dueDate?.value) {
          await prisma.payment.create({
            data: {
              amount: 0,
              date: new Date(pay.dueDate.value),
              invoiceId: invoice.id,
            },
          });
        }
      }
    }
  }

  console.log("✅ Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
