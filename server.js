/**
 * Nexus AUIS - Backend Server
 * Node.js + Express + MongoDB + Socket.io + JWT
 * Run: npm install, then node server.js
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://na23192_db_user:20042004na@cluster0.wvnabc0.mongodb.net/?appName=Cluster0";
const JWT_SECRET = process.env.JWT_SECRET || "nexus_auis_secret_2025";
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.static(path.join(__dirname, "public"))); 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ─── MongoDB Connection ───────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

// ─── Schemas & Models ─────────────────────────────────────────────────────────

// User Schema
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  major: {
    type: String,
    enum: ["IT", "SE", "CS", "Business", "English", "Law", "Other"],
    default: "Other"
  },
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Material" }],
  createdAt: { type: Date, default: Date.now }
});

// Material Schema
const MaterialSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  type: { type: String, enum: ["Lecture", "Assignment", "Book", "Notes", "Past Exam", "Other"], default: "Other" },
  major: { type: String, enum: ["IT", "SE", "CS", "Business", "English", "Law", "Other"], default: "Other" },
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  ratings: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, value: { type: Number, min: 1, max: 5 } }],
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: Date.now }
  }],
  downloadCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Chat Message Schema
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

// ─── Auth Middleware ───────────────────────────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user) return res.status(401).json({ error: "User not found" });
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ─── File Upload ───────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".docx", ".doc", ".pptx", ".ppt", ".zip", ".txt",
                     ".xlsx", ".xls", ".png", ".jpg", ".jpeg", ".gif"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("File type not allowed"));
  }
});

// ─── MIME Type Map ─────────────────────────────────────────────────────────────
const MIME_MAP = {
  ".pdf":  "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc":  "application/msword",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt":  "application/vnd.ms-powerpoint",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls":  "application/vnd.ms-excel",
  ".zip":  "application/zip",
  ".txt":  "text/plain",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif"
};

// ─── Auth Routes ───────────────────────────────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, major } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "All fields required" });
    if (await User.findOne({ email })) return res.status(409).json({ error: "Email already registered" });

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, password: hashed, major });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, major: user.major }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password))
      return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, major: user.major }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ─── Material Routes ───────────────────────────────────────────────────────────
app.get("/api/materials", async (req, res) => {
  try {
    const { major, type, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (major) filter.major = major;
    if (type) filter.type = type;
    if (search) filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } }
    ];

    const total = await Material.countDocuments(filter);
    const materials = await Material.find(filter)
      .populate("uploader", "name major")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ materials, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/materials", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File required" });
    const { title, description, type, major } = req.body;
    if (!title) return res.status(400).json({ error: "Title required" });

    const material = await Material.create({
      title,
      description,
      type: type || "Other",
      major: major || req.user.major || "Other",
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploader: req.user._id
    });

    await material.populate("uploader", "name major");
    res.status(201).json({ material });
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

// ─── CRITICAL: Universal Binary Download Route ─────────────────────────────────
// Clears output buffer, sets correct MIME types, prevents Word "Unreadable Content"
app.get("/api/materials/:id/download", async (req, res) => {
  try {
    const material = await Material.findByIdAndUpdate(
      req.params.id,
      { $inc: { downloadCount: 1 } },
      { new: true }
    );
    if (!material) return res.status(404).json({ error: "Material not found" });

    const filePath = path.join(UPLOAD_DIR, material.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found on server" });

    const ext = path.extname(material.originalName).toLowerCase();
    const mimeType = MIME_MAP[ext] || "application/octet-stream";

    // CRITICAL: Read file into buffer first to ensure clean output
    const fileBuffer = fs.readFileSync(filePath);

    // Clear any existing headers to prevent corruption
    res.removeHeader("Transfer-Encoding");
    res.removeHeader("Content-Encoding");

    // Set proper headers before sending
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(material.originalName)}"`);
    res.setHeader("Content-Length", fileBuffer.length);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // Send clean buffer — no extra bytes, prevents Word corruption
    res.end(fileBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/materials/mine", authMiddleware, async (req, res) => {
  try {
    const materials = await Material.find({ uploader: req.user._id }).sort({ createdAt: -1 });
    res.json({ materials });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/materials/:id", authMiddleware, async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ error: "Not found" });
    if (material.uploader.toString() !== req.user._id.toString())
      return res.status(403).json({ error: "Not authorized" });

    const { title, description, type, major } = req.body;
    if (title) material.title = title;
    if (description !== undefined) material.description = description;
    if (type) material.type = type;
    if (major) material.major = major;
    await material.save();
    res.json({ material });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/materials/:id", authMiddleware, async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ error: "Not found" });
    if (material.uploader.toString() !== req.user._id.toString())
      return res.status(403).json({ error: "Not authorized" });

    const filePath = path.join(UPLOAD_DIR, material.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await material.deleteOne();
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Rating Route ─────────────────────────────────────────────────────────────
app.post("/api/materials/:id/rate", authMiddleware, async (req, res) => {
  try {
    const { value } = req.body;
    if (!value || value < 1 || value > 5) return res.status(400).json({ error: "Rating must be 1-5" });

    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ error: "Not found" });

    const existing = material.ratings.find(r => r.user.toString() === req.user._id.toString());
    if (existing) existing.value = value;
    else material.ratings.push({ user: req.user._id, value });
    await material.save();

    const avg = material.ratings.reduce((a, r) => a + r.value, 0) / material.ratings.length;
    res.json({ averageRating: avg.toFixed(1), totalRatings: material.ratings.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Comment Routes ───────────────────────────────────────────────────────────
app.post("/api/materials/:id/comments", authMiddleware, async (req, res) => {
  try {
    const { text, parentId } = req.body;
    if (!text) return res.status(400).json({ error: "Comment text required" });

    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ error: "Not found" });

    material.comments.push({ user: req.user._id, text, parent: parentId || null });
    await material.save();
    await material.populate("comments.user", "name major");
    res.json({ comments: material.comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bookmark Routes ──────────────────────────────────────────────────────────
app.post("/api/bookmarks/:id", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const matId = req.params.id;
    const idx = user.bookmarks.indexOf(matId);
    if (idx > -1) user.bookmarks.splice(idx, 1);
    else user.bookmarks.push(matId);
    await user.save();
    res.json({ bookmarks: user.bookmarks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/bookmarks", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "bookmarks",
      populate: { path: "uploader", select: "name major" }
    });
    res.json({ bookmarks: user.bookmarks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat History ─────────────────────────────────────────────────────────────
app.get("/api/chat/:room", async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.room })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ messages: messages.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Socket.io — Real-Time Chat ───────────────────────────────────────────────
const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  socket.on("join", ({ token, room = "general" }) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      connectedUsers.set(socket.id, { userId: decoded.id, room });
      socket.join(room);
      io.to(room).emit("userCount", io.sockets.adapter.rooms.get(room)?.size || 0);
      socket.emit("joined", { room });
    } catch {
      socket.emit("error", "Authentication failed");
    }
  });

  socket.on("message", async ({ token, text, room = "general" }) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).select("name major");
      if (!user) return;

      const msg = await Message.create({
        user: user._id,
        userName: user.name,
        major: user.major,
        text: text.trim().slice(0, 1000),
        room
      });

      io.to(room).emit("message", {
        id: msg._id,
        userName: user.name,
        major: user.major,
        text: msg.text,
        createdAt: msg.createdAt
      });
    } catch (err) {
      socket.emit("error", "Failed to send message");
    }
  });

  socket.on("disconnect", () => {
    const info = connectedUsers.get(socket.id);
    if (info) {
      const room = info.room;
      connectedUsers.delete(socket.id);
      io.to(room).emit("userCount", io.sockets.adapter.rooms.get(room)?.size || 0);
    }
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 Nexus AUIS server running at http://localhost:${PORT}`);
});
module.exports = app;