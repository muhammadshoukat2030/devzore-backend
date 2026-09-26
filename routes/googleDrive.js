import express from "express";
import { google } from "googleapis";

const router = express.Router();

// ======================================================
// GOOGLE OAUTH CLIENT
// ======================================================

const getOAuthClient = () => {
    if (!process.env.GOOGLE_CLIENT_ID) {
        throw new Error("GOOGLE_CLIENT_ID is missing");
    }

    if (!process.env.GOOGLE_CLIENT_SECRET) {
        throw new Error("GOOGLE_CLIENT_SECRET is missing");
    }

    if (!process.env.GOOGLE_REDIRECT_URI) {
        throw new Error("GOOGLE_REDIRECT_URI is missing");
    }

    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
};

// ======================================================
// START GOOGLE AUTHENTICATION
// GET /api/google-drive/auth
// ======================================================

router.get("/auth", (req, res) => {
    try {
        const oauth2Client = getOAuthClient();

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: [
                "https://www.googleapis.com/auth/drive.file",
            ],
        });

        return res.redirect(authUrl);
    } catch (error) {
        console.error("❌ Google Auth Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to start Google authentication",
            error: error.message,
        });
    }
});

// ======================================================
// GOOGLE CALLBACK
// GET /api/google-drive/callback
// ======================================================

router.get("/callback", async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res.status(400).json({
                success: false,
                message: "Google authorization code is missing",
            });
        }

        const oauth2Client = getOAuthClient();

        const { tokens } = await oauth2Client.getToken(code);

        oauth2Client.setCredentials(tokens);

        console.log("=================================");
        console.log("✅ GOOGLE DRIVE CONNECTED");
        console.log("Access Token Received:", Boolean(tokens.access_token));
        console.log("Refresh Token Received:", Boolean(tokens.refresh_token));
        console.log("=================================");

        return res.status(200).json({
            success: true,
            message: "Google Drive connected successfully ✅",
            accessTokenReceived: Boolean(tokens.access_token),
            refreshTokenReceived: Boolean(tokens.refresh_token),
        });
    } catch (error) {
        console.error("❌ Google Callback Error:", error);

        return res.status(500).json({
            success: false,
            message: "Google Drive authentication failed",
            error: error.message,
        });
    }
});

export default router;