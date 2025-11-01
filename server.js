// Load environment variables
require("dotenv").config();
console.log("✅ .env file loaded successfully!");
console.log("Twilio SID loaded?", !!process.env.TWILIO_ACCOUNT_SID);
console.log("Firebase key loaded?", !!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64);

// Dependencies
const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const twilio = require("twilio");

// Initialize Express
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Initialize Firebase
if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT_BASE64 is missing or undefined!");
}


const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


const db = admin.firestore();

// ----------------------
// Twilio Webhook Endpoint
// ----------------------
app.post("/twilio-webhook", async (req, res) => {
  const fromNumber = req.body.From;
  const body = req.body.Body ? req.body.Body.trim().toUpperCase() : "";

  try {
    const subscriberRef = db.collection("subscribers").doc(fromNumber);

    if (body === "STOP") {
      await subscriberRef.delete();
      await client.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER,
        to: fromNumber,
        body: "You have been unsubscribed from Hershey Ward alerts.",
      });
    } else {
      // Add subscriber if not exists
      const doc = await subscriberRef.get();
      if (!doc.exists) {
        await subscriberRef.set({ subscribedAt: new Date().toISOString() });

        await client.messages.create({
          from: process.env.TWILIO_PHONE_NUMBER,
          to: fromNumber,
          body:
            "Thank you for subscribing to the Hershey Ward alerts! Reply STOP to unsubscribe.",
        });
      }
    }

    res.set("Content-Type", "text/xml");
    res.send("<Response></Response>"); // Twilio expects valid XML
  } catch (err) {
    console.error(err);
    res.status(500).send("<Response></Response>");
  }
});

// ----------------------
// Endpoint to send alerts
// ----------------------
app.post("/send-alert", async (req, res) => {
  const message = req.body.message;
  if (!message || message.length > 200) {
    return res.status(400).send({ error: "Message required (max 200 chars)" });
  }

  try {
    const subscribersSnapshot = await db.collection("subscribers").get();
    const sendPromises = [];

    subscribersSnapshot.forEach((doc) => {
      sendPromises.push(
        client.messages.create({
          from: process.env.TWILIO_PHONE_NUMBER,
          to: doc.id,
          body: message,
        })
      );
    });

    await Promise.all(sendPromises);
    res.send({ success: true, sentTo: subscribersSnapshot.size });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Failed to send messages" });
  }
});

// ----------------------
// Start Server
// ----------------------
const port = process.env.PORT || 8080;

app.listen(port, () => console.log(`✅ Server running on port ${port}`));
