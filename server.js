import "dotenv/config";

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";

// Routes
import authRoutes from "./routes/auth.js";
import postRoutes from "./routes/posts.js";
import categoryRoutes from "./routes/categories.js";
import uploadRoutes from "./routes/upload.js";
import commentRoutes from "./routes/comments.js";
import googleDriveRoutes, {
  getDriveClient,
} from "./routes/googleDrive.js";
import sitemapRoutes from "./routes/sitemap.js";

// Services
import { startScheduledPostPublisher } from "./services/scheduledPostService.js";

// APP

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI?.trim();

// Behind Vercel / reverse proxy
app.set("trust proxy", 1);

// Remove Express header
app.disable("x-powered-by");

// ENV VALIDATION

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing in environment variables.");
  process.exit(1);
}

const googleClientIdConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID?.trim()
);

const googleClientSecretConfigured = Boolean(
  process.env.GOOGLE_CLIENT_SECRET?.trim()
);

const googleRedirectUriConfigured = Boolean(
  process.env.GOOGLE_REDIRECT_URI?.trim()
);

const googleRefreshTokenConfigured = Boolean(
  process.env.GOOGLE_REFRESH_TOKEN?.trim()
);

const googleOAuthConfigured =
  googleClientIdConfigured &&
  googleClientSecretConfigured &&
  googleRedirectUriConfigured;

const googleDriveFullyConfigured =
  googleOAuthConfigured &&
  googleRefreshTokenConfigured;

if (!googleOAuthConfigured) {
  console.warn(
    "⚠️ Google OAuth configuration is incomplete."
  );
}

if (
  googleOAuthConfigured &&
  !googleRefreshTokenConfigured
) {
  console.warn(
    "⚠️ GOOGLE_REFRESH_TOKEN is missing."
  );
}

// SECURITY

app.use(
  helmet({
    /*
     * Important for images requested by:
     *
     * localhost:5173 -> localhost:5000
     * devzore.com -> backend domain
     *
     * Prevents:
     * ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
     */
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },

    /*
     * API backend does not need COEP.
     */
    crossOriginEmbedderPolicy: false,
  })
);

app.use(morgan("dev"));

// CORS

const normalizeOrigin = (value) => {
  if (!value) return "";

  return String(value)
    .trim()
    .replace(/\/+$/, "");
};

const allowedOrigins = new Set(
  [
    "http://localhost:5173",
    "http://localhost:5174",

    "https://devzore.com",
    "https://www.devzore.com",

    process.env.FRONTEND_URL,
    process.env.ADMIN_URL,
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
);

const corsOptions = {
  origin(origin, callback) {
    /*
     * Requests without Origin:
     *
     * Postman
     * Google OAuth callback
     * server-to-server
     */
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin =
      normalizeOrigin(origin);

    if (
      allowedOrigins.has(normalizedOrigin)
    ) {
      return callback(null, true);
    }

    console.error(
      "❌ CORS blocked:",
      normalizedOrigin
    );

    return callback(
      new Error(
        `CORS policy blocked origin: ${normalizedOrigin}`
      )
    );
  },

  credentials: true,

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
  ],

  exposedHeaders: [
    "Content-Length",
    "Content-Type",
    "Cache-Control",
  ],

  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// RATE LIMITER

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  /*
   * Public blog/API requests.
   * High enough for normal website usage.
   */
  limit: 500,

  standardHeaders: "draft-7",

  legacyHeaders: false,

  skip(req) {
    const path =
      req.originalUrl || req.path || "";

    /*
     * Don't rate-limit:
     *
     * authentication
     * image upload / image delivery
     * Google OAuth
     */
    return (
      path.startsWith("/api/auth") ||
      path.startsWith("/api/upload") ||
      path.startsWith("/api/google-drive")
    );
  },

  message: {
    success: false,
    message:
      "Too many requests. Please try again later.",
  },
});

app.use(apiLimiter);

// BODY PARSERS

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

// STATIC FILES

app.use(
  express.static("public", {
    maxAge:
      process.env.NODE_ENV === "production"
        ? "1d"
        : 0,

    setHeaders(res) {
      /*
       * Public assets/images can be rendered
       * from frontend origin.
       */
      res.setHeader(
        "Cross-Origin-Resource-Policy",
        "cross-origin"
      );
    },
  })
);

// API ROUTES

app.use("/api/auth", authRoutes);

app.use("/api/posts", postRoutes);

app.use("/api/categories", categoryRoutes);

app.use("/api/upload", uploadRoutes);

app.use("/api/comments", commentRoutes);

app.use(
  "/api/google-drive",
  googleDriveRoutes
);

app.use("/api/sitemap", sitemapRoutes);

// ROOT

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,

    message:
      "DevZore Blog API is running ✅",

    version: "1.0.0",

    environment:
      process.env.NODE_ENV ||
      "development",

    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",

    googleDrive: {
      oauthConfigured:
        googleOAuthConfigured,

      refreshTokenConfigured:
        googleRefreshTokenConfigured,

      fullyConfigured:
        googleDriveFullyConfigured,
    },

    endpoints: {
      health: "/health",
      auth: "/api/auth",
      posts: "/api/posts",
      categories: "/api/categories",
      uploads: "/api/upload",
      comments: "/api/comments",
      googleDrive:
        "/api/google-drive",
      sitemap: "/api/sitemap",
    },
  });
});

// HEALTH

app.get("/health", (req, res) => {
  const databaseConnected =
    mongoose.connection.readyState === 1;

  const healthy = databaseConnected;

  return res
    .status(healthy ? 200 : 503)
    .json({
      success: healthy,

      status: healthy
        ? "OK"
        : "DEGRADED",

      timestamp:
        new Date().toISOString(),

      database: databaseConnected
        ? "connected"
        : "disconnected",

      googleDrive: {
        oauthConfigured:
          googleOAuthConfigured,

        refreshTokenConfigured:
          googleRefreshTokenConfigured,

        fullyConfigured:
          googleDriveFullyConfigured,
      },
    });
});

// GOOGLE DRIVE STARTUP TEST

const verifyGoogleDriveConnection =
  async () => {
    if (!googleDriveFullyConfigured) {
      console.warn(
        "⚠️ Google Drive startup verification skipped."
      );

      return;
    }

    try {
      const drive =
        getDriveClient();

      const response =
        await drive.about.get({
          fields:
            "user(displayName,emailAddress)",
        });

      console.log("");
      console.log(
        "================================="
      );

      console.log(
        "✅ Google Drive Authentication OK"
      );

      if (
        response?.data?.user
          ?.emailAddress
      ) {
        console.log(
          `📁 Drive Account: ${response.data.user.emailAddress}`
        );
      }

      console.log(
        "================================="
      );
      console.log("");
    } catch (error) {
      const googleError =
        error?.response?.data?.error ||
        error?.cause?.message ||
        error?.message;

      const errorDescription =
        error?.response?.data
          ?.error_description ||
        "";

      console.error("");
      console.error(
        "================================="
      );

      console.error(
        "❌ GOOGLE DRIVE AUTH FAILED"
      );

      console.error(
        "Reason:",
        googleError
      );

      if (errorDescription) {
        console.error(
          "Description:",
          errorDescription
        );
      }

      if (
        String(googleError)
          .toLowerCase()
          .includes(
            "invalid_grant"
          ) ||
        String(errorDescription)
          .toLowerCase()
          .includes("expired") ||
        String(errorDescription)
          .toLowerCase()
          .includes("revoked")
      ) {
        console.error("");
        console.error(
          "⚠️ Stored Google refresh token is invalid, expired or revoked."
        );

        console.error(
          `Open: http://localhost:${PORT}/api/google-drive/auth`
        );

        console.error(
          "Then replace GOOGLE_REFRESH_TOKEN in your environment."
        );
      }

      console.error(
        "================================="
      );
      console.error("");
    }
  };

// 404

app.use((req, res) => {
  return res.status(404).json({
    success: false,

    message: `Route ${req.originalUrl} not found`,
  });
});

// GLOBAL ERROR HANDLER

app.use(
  (error, req, res, next) => {
    console.error(
      "❌ Server Error:",
      error
    );

    /*
     * Multer/route handlers normally handle
     * their own errors.
     *
     * This catches anything remaining.
     */

    if (res.headersSent) {
      return next(error);
    }

    const statusCode =
      Number(
        error?.statusCode ||
          error?.status
      ) || 500;

    return res
      .status(statusCode)
      .json({
        success: false,

        message:
          error?.message ||
          "Internal Server Error",

        ...(process.env.NODE_ENV ===
          "development" && {
          error:
            error?.stack ||
            error?.message,
        }),
      });
  }
);

// DATABASE EVENTS

mongoose.connection.on(
  "error",
  (error) => {
    console.error(
      "❌ MongoDB Runtime Error:",
      error.message
    );
  }
);

mongoose.connection.on(
  "disconnected",
  () => {
    console.warn(
      "⚠️ MongoDB disconnected."
    );
  }
);

mongoose.connection.on(
  "reconnected",
  () => {
    console.log(
      "✅ MongoDB reconnected."
    );
  }
);

// START APPLICATION

let server = null;

const startApplication = async () => {
  try {
    await mongoose.connect(
      MONGODB_URI
    );

    console.log("");
    console.log(
      "================================="
    );

    console.log(
      "✅ MongoDB Connected"
    );

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

    console.log(
      `🔑 Google Refresh Token: ${
        googleRefreshTokenConfigured
          ? "Configured ✅"
          : "Not Configured ❌"
      }`
    );

    console.log(
      `📁 Google Drive: ${
        googleDriveFullyConfigured
          ? "Ready for verification ✅"
          : "Incomplete ❌"
      }`
    );

    console.log(
      "================================="
    );
    console.log("");

    // Scheduled publishing
    startScheduledPostPublisher();

    // Start HTTP server
    server = app.listen(
      PORT,
      () => {
        console.log(
          `🚀 Server running on http://localhost:${PORT}`
        );

        console.log(
          `❤️ Health check: http://localhost:${PORT}/health`
        );

        console.log(
          `🔐 Google Drive Auth: http://localhost:${PORT}/api/google-drive/auth`
        );

        console.log(
          `🧪 Google Drive Test: http://localhost:${PORT}/api/google-drive/test`
        );

        console.log("");

        /*
         * Verify Drive after server starts.
         * This does NOT block website startup.
         */
        verifyGoogleDriveConnection();
      }
    );
  } catch (error) {
    console.error(
      "❌ Application Startup Failed:"
    );

    console.error(
      error?.message || error
    );

    process.exit(1);
  }
};

startApplication();

// GRACEFUL SHUTDOWN

const shutdown = async (
  signal
) => {
  console.log("");
  console.log(
    `⚠️ ${signal} received. Shutting down...`
  );

  try {
    if (server) {
      await new Promise(
        (resolve) => {
          server.close(resolve);
        }
      );
    }

    if (
      mongoose.connection
        .readyState !== 0
    ) {
      await mongoose.connection.close();
    }

    console.log(
      "✅ Server shutdown complete."
    );

    process.exit(0);
  } catch (error) {
    console.error(
      "❌ Shutdown error:",
      error
    );

    process.exit(1);
  }
};

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

// UNHANDLED ERRORS

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "❌ Unhandled Promise Rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "❌ Uncaught Exception:",
      error
    );

    process.exit(1);
  }
);

export default app;