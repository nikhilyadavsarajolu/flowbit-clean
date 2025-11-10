from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
import os
import re
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

app = FastAPI(title="Vanna AI Server")

# Allow frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

def get_db():
    return psycopg2.connect(DATABASE_URL)

groq_client = Groq(api_key=GROQ_API_KEY)

@app.get("/")
def root():
    return {"status": "Vanna AI server running ✅"}

@app.post("/generate-sql")
async def generate_sql(request: Request):
    body = await request.json()
    query = body.get("query", "").lower()

    if not query:
        return {"error": "No query provided"}

    # Step 1: Common predefined questions
    if "total spend" in query and "90" in query:
        sql = """
        SELECT SUM(amount) AS total_spend
        FROM "Invoice"
        WHERE date >= CURRENT_DATE - INTERVAL '90 days';
        """

    elif "top" in query and "vendor" in query:
        sql = """
        SELECT 
            COALESCE("Vendor".name, 'Unknown Vendor') AS vendor_name,
            SUM("Invoice".amount) AS total_spend
        FROM "Invoice"
        LEFT JOIN "Vendor" ON "Invoice"."vendorId" = "Vendor".id
        GROUP BY vendor_name
        ORDER BY total_spend DESC
        LIMIT 5;
        """

    elif "average" in query and "invoice" in query:
        sql = """SELECT AVG(amount) AS avg_invoice_value FROM "Invoice";"""

    elif "cash outflow" in query or "expenses" in query:
        sql = """
        SELECT TO_CHAR(date_trunc('month', date), 'YYYY-MM') AS month,
               SUM(ABS(amount)) AS cash_outflow
        FROM "Invoice"
        WHERE amount < 0
        GROUP BY month
        ORDER BY month;
        """

    elif "spend by category" in query or "category spend" in query:
        sql = """
        SELECT 
            COALESCE("Vendor".category, 'Uncategorized') AS category,
            SUM("Invoice".amount) AS total_spend
        FROM "Invoice"
        LEFT JOIN "Vendor" ON "Invoice"."vendorId" = "Vendor".id
        GROUP BY category
        ORDER BY total_spend DESC;
        """

    elif "overdue" in query or "pending" in query:
        sql = """
        SELECT "invoiceNo", date, amount, status
        FROM "Invoice"
        WHERE status ILIKE '%pending%' OR status ILIKE '%overdue%';
        """

    elif "processed" in query and ("this month" in query or "current month" in query):
        sql = """
        SELECT "invoiceNo", date, amount, status
        FROM "Invoice"
        WHERE status ILIKE '%processed%'
        AND date >= date_trunc('month', CURRENT_DATE)
        ORDER BY date DESC;
        """

    elif "compare" in query and "vendor" in query and "quarter" in query:
        sql = """
        SELECT 
            "Vendor".name AS vendor_name,
            SUM("Invoice".amount) AS total_spend
        FROM "Invoice"
        LEFT JOIN "Vendor" ON "Invoice"."vendorId" = "Vendor".id
        WHERE date >= date_trunc('quarter', CURRENT_DATE)
        GROUP BY vendor_name
        ORDER BY total_spend DESC;
        """

    elif "above" in query and "invoice" in query:
        amount_match = re.search(r'\b(\d{3,6})\b', query)
        threshold = amount_match.group(1) if amount_match else "1000"
        sql = f"""
        SELECT "invoiceNo", date, amount, status
        FROM "Invoice"
        WHERE amount > {threshold}
        ORDER BY amount DESC;
        """

    elif "total pending" in query or "pending amount" in query:
        sql = """
        SELECT SUM(amount) AS total_pending_amount
        FROM "Invoice"
        WHERE status ILIKE '%pending%';
        """

    elif "invoice count" in query and "vendor" in query:
        sql = """
        SELECT 
            "Vendor".name AS vendor_name,
            COUNT("Invoice".id) AS invoice_count
        FROM "Invoice"
        LEFT JOIN "Vendor" ON "Invoice"."vendorId" = "Vendor".id
        GROUP BY vendor_name
        ORDER BY invoice_count DESC;
        """

    elif "category" in query and "this year" in query:
        sql = """
        SELECT 
            COALESCE("Vendor".category, 'Uncategorized') AS category,
            SUM("Invoice".amount) AS total_spend
        FROM "Invoice"
        LEFT JOIN "Vendor" ON "Invoice"."vendorId" = "Vendor".id
        WHERE date >= date_trunc('year', CURRENT_DATE)
        GROUP BY category
        ORDER BY total_spend DESC;
        """

    else:
        # Step 2: Use Groq AI fallback
        prompt = f"""
You are an expert SQL assistant with knowledge of this PostgreSQL schema:

Tables:
- "Invoice"(id, invoiceNo, vendorId, date, amount, status)
- "Vendor"(id, name, category)
- "Payment"(id, invoiceId, method, amount, date)
- "LineItem"(id, description, quantity, price, invoiceId)

Generate a valid SQL query (PostgreSQL) to answer this question:
{query}

Return **only** SQL code (no explanations).
"""
        try:
            completion = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
            )
            sql = completion.choices[0].message.content.strip()
            if "```" in sql:
                sql = sql.replace("```sql", "").replace("```", "").strip()
        except Exception as e:
            print("Groq error:", e)
            return {"query": query, "error": str(e)}

    # Step 3: Execute SQL safely
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchall()
        columns = [desc[0] for desc in cur.description]
        cur.close()
        conn.close()

        results = [dict(zip(columns, row)) for row in rows]
        return {"query": query, "sql": sql, "result": results}

    except Exception as e:
        print("❌ SQL Execution Error:", e)
        return {"query": query, "sql": sql, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
