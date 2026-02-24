import express, { Request, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { authenticateToken } from "../middleware/authMiddleware";
import { v4 as uuidv4 } from "uuid";
import rateLimit from "express-rate-limit";

const router = express.Router();

// ── Constants ────────────────────────────────────────────────────────────────

/** All images are stored at this resolution — 16:9, max 1280px wide */
const TARGET_WIDTH  = 1280;
const TARGET_HEIGHT = 720;  // exactly 16:9

// ── Rate limiter ─────────────────────────────────────────────────────────────

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many uploads, please try again later." },
});

// ── Multer (memory storage — sharp processes before S3) ───────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

// ── S3 client ─────────────────────────────────────────────────────────────────

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// ── POST /image ───────────────────────────────────────────────────────────────

router.post(
  "/image",
  uploadLimiter,
  authenticateToken,
  upload.single("image"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });

      // Resize + centre-crop to exactly 16:9 (1280x720).
      // `cover` fills the target box and crops any overflow — the image is
      // never stretched or letter-boxed, just trimmed to fit.
      const processed = await sharp(req.file.buffer)
        .resize(TARGET_WIDTH, TARGET_HEIGHT, {
          fit:      "cover",
          position: "centre",
        })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();

      const key = `chat-images/${uuidv4()}.jpg`;

      await s3.send(
        new PutObjectCommand({
          Bucket:      process.env.AWS_BUCKET_NAME!,
          Key:         key,
          Body:        processed,
          ContentType: "image/jpeg",
        }),
      );

      const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
      res.json({ imageUrl });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

export default router;