/**
 * Nexus AUIS - Backend Server
 * Node.js + Express + MongoDB + Pusher + Cloudinary
 */

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const Pusher = require("pusher");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();
const server = http.createServer(app);

// ─── PUSHER CONFIG (Real-Time Chat) ───────────────────────────────────────────
const pusher = new Pusher({
  appId: "2143448",
  key: "c13e5901d85bfa53ba80",
  secret: "f2c42d328406f5277189", 
  cluster: "mt1",
  useTLS: true
});

// ─── CLOUDINARY CONFIG (Permanent File Storage) ───────────────────────────────
cloudinary.config({ 
  cloud_name: 'dqxlyq8p2', 
  api_key: '967674391264426', 
  api_secret: 'Z6fBOnuCWhA_Z32XpI7M8H9X9xU' 
});

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://na23192_db_user:20042004na@cluster0.wvnabc0.mongodb.net/?appName=Cluster0";
const JWT_SECRET = process.env.JWT_SECRET || "nexus_auis_secret_2025";

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── MongoDB Connection ───────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

// ─── Schemas & Models ─────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  major: { type: String, default: "Other" },
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Material" }],
  createdAt: { type: Date, default: Date.now }
});

const MaterialSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  type: String,
  major: String,
  fileUrl: String, // URL from Cloudinary
  public_id: String, // Reference for Cloudinary
  originalName: String,
  mimetype: String,
  size: Number,
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  userName: String,
  major: String,
  text: { type: String, required: true },
  room: { type: String, default: "general" },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);
const Material = mongoose.model("Material", MaterialSchema);
const Message = mongoose.model("Message", MessageSchema);

// ─── Auth Middleware ──────────────────────────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
};

// ─── File Upload (Cloudinary) ─────────────────────────────────────────────────
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nexus_auis_uploads',
    resource_type: 'auto'
  },
});
const upload = multer({ storage: storage });

// ─── Auth Routes ───────────────────────────────────────────────────────────────
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

// ─── Material Routes (Cloudinary Powered) ──────────────────────────────────────
app.post("/api/materials", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const { title, description, type, major } = req.body;
    const material = await Material.create({
      title, description, type, major,
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

// ─── Chat Routes (Pusher Powered) ──────────────────────────────────────────────
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

    // PUSH LIVE TO ALL USERS
    pusher.trigger(room, "new-message", {
      userName: req.user.name,
      major: req.user.major,
      text: msg.text,
      createdAt: msg.createdAt
    });

    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/chat/:room", async (req, res) => {
  const messages = await Message.find({ room: req.params.room }).sort({ createdAt: -1 }).limit(50);
  res.json({ messages: messages.reverse() });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => console.log(`🚀 Nexus AUIS Live at http://localhost:${PORT}`));