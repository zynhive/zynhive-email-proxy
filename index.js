// ─── index.js ─────────────────────────────────────────────────────────────────
// Email proxy server — deploy on Render.com (FREE)
// Fixes CORS issue when sending emails from frontend

const express = require("express");
const app     = express();
const PORT    = process.env.PORT || 3001;

app.use(express.json());

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin",  "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status:  "ok",
    service: "ZynHive Email Proxy",
    time:    new Date().toISOString(),
  });
});

// ── Single Email ──────────────────────────────────────────────────────────────
app.post("/sendEmail", async (req, res) => {
  try {
    const { to, subject, body, replyTo } = req.body;

    // Validation
    if (!to || !subject || !body) {
      return res.status(400).json({
        success: false,
        error: "to, subject, body are required",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email address: " + to,
      });
    }

    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev";
    const FROM_NAME  = process.env.FROM_NAME  || "ZynHive CRM";

    // Dev mode — no Resend key
    if (!RESEND_KEY) {
      console.log("[DEV] Simulated email → to:", to, "| subject:", subject);
      return res.json({ success: true, messageId: "dev_" + Date.now() });
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + RESEND_KEY,
      },
      body: JSON.stringify({
        from:     FROM_NAME + " <" + FROM_EMAIL + ">",
        to:       [to],
        subject:  subject,
        text:     body,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[Email] Resend error:", data);
      return res.status(500).json({
        success: false,
        error: data?.message ?? "Resend send failed",
      });
    }

    console.log("[Email] Sent ✓ | to:", to, "| id:", data.id);
    return res.json({ success: true, messageId: data.id });

  } catch (err) {
    console.error("[Email] Server error:", err);
    return res.status(500).json({
      success: false,
      error: err?.message ?? "Internal server error",
    });
  }
});

// ── Batch Emails ──────────────────────────────────────────────────────────────
app.post("/sendBatchEmails", async (req, res) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: "emails array required" });
    }

    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev";
    const FROM_NAME  = process.env.FROM_NAME  || "ZynHive CRM";
    const results    = [];

    for (const email of emails) {
      try {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.to)) {
          results.push({ to: email.to, success: false, error: "Invalid email" });
          continue;
        }

        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": "Bearer " + RESEND_KEY,
          },
          body: JSON.stringify({
            from:    FROM_NAME + " <" + FROM_EMAIL + ">",
            to:      [email.to],
            subject: email.subject,
            text:    email.body,
          }),
        });

        const data = await r.json();
        results.push({
          to:        email.to,
          success:   r.ok,
          messageId: data.id,
          error:     r.ok ? undefined : data?.message,
        });
      } catch (e) {
        results.push({ to: email.to, success: false, error: e?.message });
      }

      // Resend rate limit: max 2/sec on free tier
      await new Promise((r) => setTimeout(r, 500));
    }

    const sent = results.filter((r) => r.success).length;
    console.log("[Batch] Sent " + sent + "/" + emails.length + " emails");
    return res.json({ results, sent, total: emails.length });

  } catch (err) {
    console.error("[Batch] Error:", err);
    return res.status(500).json({ success: false, error: err?.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("✅ ZynHive Email Proxy running on port " + PORT);
  console.log("   FROM_EMAIL:", process.env.FROM_EMAIL || "onboarding@resend.dev (default)");
  console.log("   RESEND_KEY:", process.env.RESEND_API_KEY ? "✓ set" : "✗ missing (dev mode)");
});
