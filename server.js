
import express from "express";
import cors from "cors";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL || false
}));

// Keep the original JSON body available for signature validation.
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "CoinSphere Payments API",
    status: "online",
    paymentsEnabled: Boolean(process.env.NOWPAYMENTS_API_KEY)
  });
});

app.post("/api/create-invoice", async (req, res) => {
  try {
    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    const baseUrl = process.env.PUBLIC_API_URL;

    if (!apiKey || !baseUrl) {
      return res.status(503).json({
        error: "Payment service is not configured."
      });
    }

    // Only accept server-defined products and prices.
    const products = {
      coinsphere_pro_monthly: {
        name: "CoinSphere Pro — Monthly",
        amount: 15
      }
    };

    const product = products[req.body?.productId];

    if (!product) {
      return res.status(400).json({ error: "Invalid product." });
    }

    const orderId = crypto.randomUUID();

    const response = await fetch(
      "https://api.nowpayments.io/v1/invoice",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          price_amount: product.amount,
          price_currency: "usd",
          order_id: orderId,
          order_description: product.name,
          ipn_callback_url: `${baseUrl}/api/nowpayments-ipn`,
          success_url: process.env.SUCCESS_URL || baseUrl,
          cancel_url: process.env.CANCEL_URL || baseUrl
        })
      }
    );

    const data = await response.json();

    if (!response.ok || !data.invoice_url) {
      console.error("NOWPayments invoice request failed:", response.status);
      return res.status(502).json({
        error: "Could not create a payment invoice."
      });
    }

    // This initial example does not persist orders to a database.
    // Add persistent order storage before accepting real payments.
    return res.status(201).json({
      orderId,
      invoiceUrl: data.invoice_url
    });
  } catch (error) {
    console.error("Invoice creation error:", error.message);
    return res.status(500).json({ error: "Internal server error." });
  }
});

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = sortObject(value[key]);
        return result;
      }, {});
  }

  return value;
}

app.post("/api/nowpayments-ipn", (req, res) => {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  const signature = req.get("x-nowpayments-sig");

  if (!secret || !signature) {
    return res.status(401).json({ error: "Missing signature configuration." });
  }

  const expected = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(sortObject(req.body)))
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid signature." });
  }

  // Signature verified, but don't grant access here yet:
  // match the order to persistent storage and verify payment status.
  console.log("Verified NOWPayments notification received.");
  return res.status(200).json({ received: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CoinSphere Payments API listening on ${PORT}`);
});
