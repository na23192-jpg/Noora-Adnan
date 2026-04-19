/**
 * Nexus AUIS - Backend Server (Full Vercel & Cloud Optimized)
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

// ─── PUSHER CONFIG ───────────────────────────────────────────────────────────
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

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; 
const JWT_SECRET = process.env.JWT_SECRET || "nexus_auis_secret_2025";

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── MONGODB CONNECTION ───────────────────────────────────────────────────────
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    isConnected = true;
    console.log("✅ MongoDB connected");
  } catch (err) { console.error("❌ MongoDB error:", err); }
};

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
  fileUrl: String, // From Cloudinary
  public_id: String,
  originalName: String,
  mimetype: String,
  size: Number,
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  ratings: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, value: { type: Number, min: 1, max: 5 } }],
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  downloadCount: { type: Number, default: 0 },
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

// ─── FILE UPLOAD (Cloudinary) ─────────────────────────────────────────────────
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'nexus_auis_uploads', resource_type: 'auto' },
});
const upload = multer({ storage: storage });

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
};

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Nexus AUIS API is Live"));

// Auth
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
    if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).json({ error: "Invalid login" });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user._id, name: user.name, email, major: user.major } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Materials
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
  const materials = await Material.find().populate("uploader", "name").sort({ createdAt: -1 });
  res.json({ materials });
});

// Rating & Bookmark logic
app.post("/api/materials/:id/rate", authMiddleware, async (req, res) => {
  const material = await Material.findById(req.params.id);
  material.ratings.push({ user: req.user._id, value: req.body.value });
  await material.save();
  res.json({ message: "Rated!" });
});

app.post("/api/bookmarks/:id", authMiddleware, async (req, res) => {
  const idx = req.user.bookmarks.indexOf(req.params.id);
  if (idx > -1) req.user.bookmarks.splice(idx, 1);
  else req.user.bookmarks.push(req.params.id);
  await req.user.save();
  res.json({ bookmarks: req.user.bookmarks });
});

// Chat (Pusher)
app.post("/api/chat/send", authMiddleware, async (req, res) => {
  const { text, room = "general" } = req.body;
  const msg = await Message.create({ user: req.user._id, userName: req.user.name, major: req.user.major, text, room });
  pusher.trigger(room, "new-message", { userName: req.user.name, text, createdAt: msg.createdAt });
  res.json(msg);
});

app.get("/api/chat/:room", async (req, res) => {
  const messages = await Message.find({ room: req.params.room }).sort({ createdAt: -1 }).limit(50);
  res.json({ messages: messages.reverse() });
});

module.exports = app;
