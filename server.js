/**
 * Nexus AUIS - Backend Server
 * Optimized for Vercel + MongoDB + Pusher + Uploadthing
 */

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const Pusher = require("pusher");

const app = express();

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; 
const JWT_SECRET = process.env.JWT_SECRET || "nexus_auis_secret_2026";
const UPLOADTHING_TOKEN = process.env.UPLOADTHING_TOKEN;

// ─── PUSHER CONFIG (Real-time Chat) ───────────────────────────────────────────
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── MONGODB CONNECTION (Serverless Optimized) ───────────────────────────────
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(MONGO_URI, { 
        serverSelectionTimeoutMS: 5000,
        dbName: 'nexus_auis' 
    });
    isConnected = true;
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
  }
};

// Middleware to ensure DB is connected before handling requests
app.use(async (req, res, next) => {
  await connectDB();
  next();
});

// ─── SCHEMAS & MODELS ─────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  major: { type: String, default: "IT" },
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Material" }],
  createdAt: { type: Date, default: Date.now }
});

const MaterialSchema = new mongoose.Schema({
  title: { type: String, required: true },
  fileUrl: { type: String, required: true }, // URL from Uploadthing
  major: { type: String },
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  uploaderName: String,
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  userName: String,
  text: { type: String, required: true },
  room: { type: String, default: "general" },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model("User", UserSchema);
const Material = mongoose.models.Material || mongoose.model("Material", MaterialSchema);
const Message = mongoose.models.Message || mongoose.model("Message", MessageSchema);

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id);
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid Token" });
  }
};

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Nexus AUIS API is running..."));

// Auth: Register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, major } = req.body;
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, password: hashed, major });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user: { name: user.name, major: user.major } });
  } catch (err) {
    res.status(400).json({ error: "User already exists or data invalid" });
  }
});

// Auth: Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid Credentials" });
    }
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { name: user.name, major: user.major } });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Materials: Save Uploaded Material
app.post("/api/materials", authMiddleware, async (req, res) => {
  try {
    const { title, fileUrl } = req.body;
    const material = await Material.create({
      title,
      fileUrl,
      major: req.user.major,
      uploader: req.user._id,
      uploaderName: req.user.name
    });
    res.status(201).json(material);
  } catch (err) {
    res.status(500).json({ error: "Failed to save material" });
  }
});

// Materials: Get All
app.get("/api/materials", async (req, res) => {
  try {
    const materials = await Material.find().sort({ createdAt: -1 });
    res.json({ materials });
  } catch (err) {
    res.status(500).json({ error: "Fetch failed" });
  }
});

// Chat: Send Message
app.post("/api/chat/send", authMiddleware, async (req, res) => {
  try {
    const { text, room = "general" } = req.body;
    const msg = await Message.create({ userName: req.user.name, text, room });
    
    // Trigger Pusher Event
    await pusher.trigger(room, "new-message", {
      userName: req.user.name,
      text,
      createdAt: msg.createdAt
    });
    
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: "Chat failed" });
  }
});

// Chat: Get History
app.get("/api/chat/:room", async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.room })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ messages: messages.reverse() });
  } catch (err) {
    res.status(500).json({ error: "History fetch failed" });
  }
});

module.exports = app;
