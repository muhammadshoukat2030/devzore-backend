import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";

// ======================================================
// LOAD ENVIRONMENT VARIABLES
// ======================================================

dotenv.config();

// ======================================================
// ROUTES
// ======================================================

import authRoutes from "./routes/auth.js";
import postRoutes from "./routes/posts.js";
import categoryRoutes from "./routes/categories.js";
import uploadRoutes from "./routes/upload.js";
import commentRoutes from "./routes/comments.js";
import googleDriveRoutes from "./routes/googleDrive.js";

// ======================================================
// APP CONFIG
// ======================================================

const app = express();

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// ======================================================
// CHECK REQUIRED ENVIRONMENT VARIABLES
// ======================================================

if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI is missing in .env");
    process.exit(1);
}

// Google OAuth variables check
const googleOAuthConfigured =
    Boolean(process.env.GOOGLE_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET) &&
    Boolean(process.env.GOOGLE_REDIRECT_URI);

if (!googleOAuthConfigured) {
    console.warn(
        "⚠️ Google Drive OAuth environment variables are incomplete."
    );
}

// ======================================================
// RATE LIMITER
// ======================================================

const limiter = rateLimit({
    // 15 minute window
    windowMs: 15 * 60 * 1000,

    // Allow 500 requests per window
    max: 500,

    // Skip rate limiting for auth/upload routes
    skip: (req) => {
        return (
            req.path.includes("/auth") ||
            req.path.includes("/upload") ||
            req.path.includes("/google-drive")
        );
    },

    standardHeaders: true,
    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many requests, please try again later.",
    },
});

// ======================================================
// SECURITY MIDDLEWARE
// ======================================================

app.use(helmet());

app.use(morgan("dev"));

app.use(limiter);

// ======================================================
// CORS CONFIGURATION
// ======================================================

const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://devzore.com",
];

// Add FRONTEND_URL from .env
if (process.env.FRONTEND_URL) {
    if (!allowedOrigins.includes(process.env.FRONTEND_URL)) {
        allowedOrigins.push(process.env.FRONTEND_URL);
    }
}

// Add ADMIN_URL from .env
if (process.env.ADMIN_URL) {
    if (!allowedOrigins.includes(process.env.ADMIN_URL)) {
        allowedOrigins.push(process.env.ADMIN_URL);
    }
}

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests without Origin
            // Example: Postman / server-to-server / OAuth redirect
            if (!origin) {
                return callback(null, true);
            }

            // Allow registered origins
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            console.error("❌ CORS blocked:", origin);

            return callback(
                new Error(`CORS policy blocked origin: ${origin}`)
            );
        },

        credentials: true,

        methods: [
            "GET",
            "POST",
            "PUT",
            "DELETE",
            "PATCH",
            "OPTIONS",
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization",
        ],
    })
);

// ======================================================
// BODY PARSER
// ======================================================

app.use(
    express.json({
        limit: "10mb",
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "10mb",
    })
);

// ======================================================
// STATIC FILES
// ======================================================

app.use(express.static("public"));

// ======================================================
// API ROUTES
// ======================================================

app.use("/api/auth", authRoutes);

app.use("/api/posts", postRoutes);

app.use("/api/categories", categoryRoutes);

app.use("/api/upload", uploadRoutes);

app.use("/api/comments", commentRoutes);

// ======================================================
// GOOGLE DRIVE OAUTH ROUTES
// ======================================================

app.use("/api/google-drive", googleDriveRoutes);

// Available Google Drive endpoints:
//
// GET /api/google-drive/auth
// GET /api/google-drive/callback
//
// ======================================================

// ======================================================
// HOME ROUTE
// ======================================================

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "DevZore Blog API is running ✅",
        version: "1.0.0",

        googleDriveOAuth: googleOAuthConfigured
            ? "configured"
            : "not configured",

        endpoints: [
            "/api/auth",
            "/api/posts",
            "/api/categories",
            "/api/upload",
            "/api/comments",
            "/api/google-drive/auth",
            "/api/google-drive/callback",
        ],
    });
});

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        status: "OK",

        timestamp: new Date().toISOString(),

        database:
            mongoose.connection.readyState === 1
                ? "connected"
                : "disconnected",

        googleDriveOAuth: googleOAuthConfigured
            ? "configured"
            : "not configured",
    });
});

// ======================================================
// 404 HANDLER
// ======================================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.originalUrl} not found`,
    });
});

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {
    console.error("❌ Error:", err.message);

    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({
        success: false,
        message:
            err.message || "Internal Server Error",
    });
});

// ======================================================
// MONGODB CONNECTION
// ======================================================

const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI);

        console.log("=================================");
        console.log("✅ MongoDB Connected");
        console.log(
            `📦 Database: ${mongoose.connection.name}`
        );

        console.log(
            `🔐 Google OAuth: ${
                googleOAuthConfigured
                    ? "Configured ✅"
                    : "Not Configured ❌"
            }`
        );

        console.log("=================================");

        // ==================================================
        // START SERVER
        // ==================================================

        app.listen(PORT, () => {
            console.log(
                `🚀 Server running on http://localhost:${PORT}`
            );

            console.log(
                `❤️ Health check: http://localhost:${PORT}/health`
            );

            console.log(
                `🔐 Google Drive Auth: http://localhost:${PORT}/api/google-drive/auth`
            );
        });
    } catch (error) {
        console.error(
            "❌ MongoDB Connection Failed:"
        );

        console.error(error.message);

        process.exit(1);
    }
};

// ======================================================
// START APPLICATION
// ======================================================

connectDB();

// ======================================================
// HANDLE UNHANDLED ERRORS
// ======================================================

process.on("unhandledRejection", (error) => {
    console.error(
        "❌ Unhandled Promise Rejection:",
        error
    );
});

process.on("uncaughtException", (error) => {
    console.error(
        "❌ Uncaught Exception:",
        error
    );

    process.exit(1);
});