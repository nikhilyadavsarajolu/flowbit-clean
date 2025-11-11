// apps/api/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import axios from "axios";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// ✅ Configure CORS (for frontend + Vanna AI)
app.use(
  cors({
    origin: ["*", "https://flowbit-frontend-8qnu.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// ✅ Root route — to verify API is working
app.get("/", (req, res) => {
  res.json({
    message: "🚀 Flowbit API running successfully!",
    endpoints: [
      "/stats",
      "/invoice-trends",
      "/vendors/top10",
      "/category-spend",
      "/cash-outflow",
      "/invoices",
      "/chat-with-data",
      "/health",
    ],
  });
});

// ✅ Health check (for monitoring)
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", db: "disconnected", error: err.message });
  }
});

// ---- /stats
app.get("/stats", async (req, res) => {
  try {
    const totalSpendAgg = await prisma.invoice.aggregate({ _sum: { amount: true } });
    const totalSpend = totalSpendAgg._sum.amount ?? 0;

    const totalInvoices = await prisma.invoice.count();
    const documentsUploaded = totalInvoices;

    const avgAgg = await prisma.invoice.aggregate({ _avg: { amount: true } });
    const averageInvoiceValue = avgAgg._avg.amount ?? 0;

    res.json({ totalSpend, totalInvoices, documentsUploaded, averageInvoiceValue });
  } catch (err) {
    console.error("❌ /stats error:", err);
    res.status(500).json({ error: "server error", details: err.message });
  }
});

// ---- /invoice-trends
app.get("/invoice-trends", async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({ select: { date: true, amount: true } });
    const map = {};
    for (const inv of invoices) {
      const d = new Date(inv.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map[key]) map[key] = { invoiceCount: 0, totalAmount: 0 };
      map[key].invoiceCount++;
      map[key].totalAmount += inv.amount ?? 0;
    }
    const result = Object.keys(map).sort().map((k) => ({ month: k, ...map[k] }));
    res.json(result);
  } catch (err) {
    console.error("❌ /invoice-trends error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---- /vendors/top10
app.get("/vendors/top10", async (req, res) => {
  try {
    const vendors = await prisma.vendor.findMany({ include: { invoices: true } });
    const arr = vendors.map((v) => ({
      id: v.id,
      name: v.name,
      category: v.category,
      totalAmount: v.invoices.reduce((s, i) => s + (i.amount ?? 0), 0),
    }));
    arr.sort((a, b) => b.totalAmount - a.totalAmount);
    res.json(arr.slice(0, 10));
  } catch (err) {
    console.error("❌ /vendors/top10 error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---- /category-spend
app.get("/category-spend", async (req, res) => {
  try {
    const vendors = await prisma.vendor.findMany({ include: { invoices: true } });
    const byCat = {};
    for (const v of vendors) {
      const total = v.invoices.reduce((s, i) => s + (i.amount ?? 0), 0);
      const cat = v.category ?? "Uncategorized";
      byCat[cat] = (byCat[cat] ?? 0) + total;
    }
    const result = Object.keys(byCat).map((k) => ({ category: k, totalAmount: byCat[k] }));
    res.json(result);
  } catch (err) {
    console.error("❌ /category-spend error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---- /cash-outflow
app.get("/cash-outflow", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const where = { amount: { lt: 0 } };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }
    const invoices = await prisma.invoice.findMany({ where, select: { date: true, amount: true } });
    const byMonth = {};
    for (const inv of invoices) {
      const d = new Date(inv.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonth[key] = (byMonth[key] ?? 0) + Math.abs(inv.amount ?? 0);
    }
    const result = Object.keys(byMonth).sort().map((k) => ({ month: k, outflow: byMonth[k] }));
    res.json(result);
  } catch (err) {
    console.error("❌ /cash-outflow error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---- /invoices
app.get("/invoices", async (req, res) => {
  try {
    const { search, status, vendorName, sortBy, sortOrder, page = 1, limit = 20, role } = req.query;
    const where = {};

    if (role === "Analyst") {
      where.status = "Processed";
    } else if (role === "Intern") {
      where.vendor = { name: { contains: "Vendor", mode: "insensitive" } };
    }

    if (status) where.status = status;
    if (vendorName) where.vendor = { name: { contains: vendorName, mode: "insensitive" } };
    if (search) where.invoiceNo = { contains: search, mode: "insensitive" };

    const pageInt = parseInt(page);
    const limitInt = parseInt(limit);
    const skip = (pageInt - 1) * limitInt;

    const orderBy = {};
    if (sortBy) orderBy[sortBy] = sortOrder === "desc" ? "desc" : "asc";
    else orderBy.date = "desc";

    const invoices = await prisma.invoice.findMany({
      where,
      include: { vendor: true },
      orderBy,
      skip,
      take: limitInt,
    });

    const totalCount = await prisma.invoice.count({ where });
    res.json({ invoices, totalCount });
  } catch (err) {
    console.error("❌ /invoices error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---- /chat-with-data (proxy to Vanna AI)
app.post("/chat-with-data", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ message: "Query required" });

  const VANNA_URL = process.env.VANNA_API_BASE_URL || "http://localhost:8000";
  console.log("🔗 Connecting to Vanna at:", VANNA_URL);

  try {
    const vannaResp = await axios.post(
      `${VANNA_URL}/generate-sql`,
      { query },
      { headers: { "Content-Type": "application/json" }, timeout: 20000 }
    );

    const { sql, result, error } = vannaResp.data;
    if (error) {
      console.error("❌ Vanna returned error:", error);
      return res.status(500).json({ query, sql, error });
    }

    res.json({ query, sql, result });
  } catch (apiErr) {
    console.error("❌ Error reaching Vanna AI:", apiErr.message);
    res.status(500).json({
      error: "Failed to reach Vanna AI server",
      details: apiErr.message,
    });
  }
});

// ✅ Local dev mode
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`🚀 API server running locally on port ${PORT}`));
}

export default app;
