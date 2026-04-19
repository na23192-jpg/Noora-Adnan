/**
 * Nexus AUIS - Backend Server (Vercel Optimized)
 * Node.js + Express + MongoDB + Pusher + Cloudinary
 */

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cors = require("cors");
const Pusher = require("pusher");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();

// ─── PUSHER CONFIG (Real-Time Chat) ───────────────────────────────────────────
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || "2143448",
  key: process.env.PUSHER_KEY || "c13e5901d85bfa53ba80",
  secret: process.env.PUSHER_SECRET || "f2c42d328406f5277189",
  cluster: process.env.PUSHER_CLUSTER || "mt1",
  useTLS: true
});

// ─── CLOUDINARY CONFIG ────────────────────────────────────────────────────────
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_NAME || 'dqxlyq8p2', 
  api_key: process.env.CLOUDINARY_API_KEY || '967674391264426', 
  api_secret: process.env.CLOUDINARY_API_SECRET || 'Z6fBOnuCWhA_Z32XpI7M8H9X9xU' 
});

// ─── CONFIG & SECRETS ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "nexus_auis_secret_2025";

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── MONGOOSE CONNECTION (Optimized for Serverless) ──────────────────────────
// We use a variable to cache the connection so we don't reconnect on every hit
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    });
    isConnected = true;
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
  }
};

// Apply connection check to all API routes
app.use(async (req, res, next) => {
  await connectDB();
  next();
});

// ─── SCHEMAS & MODELS ─────────────────────────────────────────────────────────
const User = mongoose.models.User || mongoose.model("User", new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  major: { type: String, default: "Other" },
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Material" }],
  createdAt: { type: Date, default: Date.now }
}));

const Material = mongoose.models.Material || mongoose.model("Material", new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  type: String,
  major: String,
  fileUrl: String,
  public_id: String,
  originalName: String,
  mimetype: String,
  size: Number,
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now }
}));

const Message = mongoose.models.Message || mongoose.model("Message", new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  userName: String,
  major: String,
  text: { type: String, required: true },
  room: { type: String, default: "general" },
  createdAt: { type: Date, default: Date.now }
}));

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
};

// ─── FILE UPLOAD (Cloudinary) ─────────────────────────────────────────────────
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nexus_auis_uploads',
    resource_type: 'auto'
  },
});
const upload = multer({ storage: storage });

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Health Check (Use this to test if server is alive)
app.get("/", (req, res) => res.send("Nexus AUIS API is running..."));

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, major } = req.body;
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, password: hashed, major });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user: { id: user._id, name, email, major } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).json({ error: "Invalid login credentials" });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user._id, name: user.name, email, major: user.major } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/materials", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const material = await Material.create({
      ...req.body,
      fileUrl: req.file.path,
      public_id: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploader: req.user._id
    });
    res.status(201).json({ material });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/materials", async (req, res) => {
  try {
    const materials = await Material.find().populate("uploader", "name").sort({ createdAt: -1 });
    res.json({ materials });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/chat/send", authMiddleware, async (req, res) => {
  try {
    const { text, room = "general" } = req.body;
    const msg = await Message.create({
      user: req.user._id,
      userName: req.user.name,
      major: req.user.major,
      text,
      room
    });

    await pusher.trigger(room, "new-message", {
      userName: req.user.name,
      major: req.user.major,
      text: msg.text,
      createdAt: msg.createdAt
    });

    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/chat/:room", async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.room }).sort({ createdAt: -1 }).limit(50);
    res.json({ messages: messages.reverse() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Export for Vercel
module.exports = app;

// Local Development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Local Server: http://localhost:${PORT}`));
}