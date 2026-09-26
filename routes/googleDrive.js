import express from "express";
import { google } from "googleapis";

const router = express.Router();

// ======================================================
// GOOGLE DRIVE OAUTH CONFIGURATION
// ======================================================

const DRIVE_SCOPE = [
    "https://www.googleapis.com/auth/drive.file",
];

// ======================================================
// GOOGLE OAUTH CLIENT
// ======================================================

const getOAuthClient = () => {
    const {
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI,
        GOOGLE_REFRESH_TOKEN,
    } = process.env;

    // --------------------------------------------------
    // Validate required Google OAuth variables
    // --------------------------------------------------

    if (!GOOGLE_CLIENT_ID) {
        throw new Error("GOOGLE_CLIENT_ID is missing");
    }

    if (!GOOGLE_CLIENT_SECRET) {
        throw new Error("GOOGLE_CLIENT_SECRET is missing");
    }

    if (!GOOGLE_REDIRECT_URI) {
        throw new Error("GOOGLE_REDIRECT_URI is missing");
    }

    // --------------------------------------------------
    // Create OAuth2 client
    // --------------------------------------------------

    const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI
    );

    // --------------------------------------------------
    // Attach permanent refresh token
    //
    // Once GOOGLE_REFRESH_TOKEN is stored in .env/Vercel,
    // Google can automatically obtain new access tokens.
    // --------------------------------------------------

    if (GOOGLE_REFRESH_TOKEN) {
        oauth2Client.setCredentials({
            refresh_token: GOOGLE_REFRESH_TOKEN,
        });
    }

    return oauth2Client;
};

// ======================================================
// GOOGLE DRIVE CLIENT
// ======================================================

const getDriveClient = () => {
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
        throw new Error(
            "GOOGLE_REFRESH_TOKEN is missing. Complete Google Drive OAuth setup first."
        );
    }

    const oauth2Client = getOAuthClient();

    return google.drive({
        version: "v3",
        auth: oauth2Client,
    });
};

// ======================================================
// GOOGLE DRIVE STATUS
//
// GET /api/google-drive/status
// ======================================================

router.get("/status", (req, res) => {
    try {
        const clientIdConfigured = Boolean(
            process.env.GOOGLE_CLIENT_ID
        );

        const clientSecretConfigured = Boolean(
            process.env.GOOGLE_CLIENT_SECRET
        );

        const redirectUriConfigured = Boolean(
            process.env.GOOGLE_REDIRECT_URI
        );

        const refreshTokenConfigured = Boolean(
            process.env.GOOGLE_REFRESH_TOKEN
        );

        const oauthConfigured =
            clientIdConfigured &&
            clientSecretConfigured &&
            redirectUriConfigured;

        const fullyConfigured =
            oauthConfigured &&
            refreshTokenConfigured;

        return res.status(200).json({
            success: true,

            configured: oauthConfigured,

            refreshTokenConfigured,

            fullyConfigured,

            message: fullyConfigured
                ? "Google Drive is fully configured ✅"
                : oauthConfigured
                ? "Google OAuth configured, but refresh token is missing."
                : "Google Drive configuration is incomplete.",
        });
    } catch (error) {
        console.error(
            "❌ Google Drive Status Error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to check Google Drive status",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
});

// ======================================================
// START GOOGLE AUTHENTICATION
//
// GET /api/google-drive/auth
// ======================================================

router.get("/auth", (req, res) => {
    try {
        const oauth2Client = getOAuthClient();

        const authUrl = oauth2Client.generateAuthUrl({
            // Required if we want a refresh token
            access_type: "offline",

            // Forces consent screen so Google can issue
            // a refresh token during setup
            prompt: "consent",

            scope: DRIVE_SCOPE,

            include_granted_scopes: true,
        });

        return res.redirect(authUrl);
    } catch (error) {
        console.error(
            "❌ Google Auth Error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to start Google authentication",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
});

// ======================================================
// GOOGLE OAUTH CALLBACK
//
// GET /api/google-drive/callback
// ======================================================

router.get("/callback", async (req, res) => {
    try {
        const {
            code,
            error: googleError,
        } = req.query;

        // --------------------------------------------------
        // User denied/cancelled Google permission
        // --------------------------------------------------

        if (googleError) {
            return res.status(400).json({
                success: false,
                message:
                    "Google authorization was denied",
                error: googleError,
            });
        }

        // --------------------------------------------------
        // Authorization code is required
        // --------------------------------------------------

        if (!code) {
            return res.status(400).json({
                success: false,
                message:
                    "Google authorization code is missing",
            });
        }

        const oauth2Client = getOAuthClient();

        // --------------------------------------------------
        // Exchange authorization code for tokens
        // --------------------------------------------------

        const { tokens } =
            await oauth2Client.getToken(code);

        oauth2Client.setCredentials(tokens);

        const accessTokenReceived =
            Boolean(tokens.access_token);

        const refreshTokenReceived =
            Boolean(tokens.refresh_token);

        // ==================================================
        // ONE-TIME LOCAL REFRESH TOKEN DISPLAY
        // ==================================================
        //
        // SECURITY:
        //
        // This is ONLY intended for initial local setup.
        //
        // .env:
        //
        // NODE_ENV=development
        // SHOW_GOOGLE_REFRESH_TOKEN_ONCE=true
        //
        // After OAuth succeeds, the refresh token will
        // appear ONCE in your local terminal.
        //
        // Copy:
        //
        // GOOGLE_REFRESH_TOKEN=xxxxxxxx
        //
        // into your local .env and later into Vercel
        // Environment Variables.
        //
        // Then DELETE:
        //
        // SHOW_GOOGLE_REFRESH_TOKEN_ONCE=true
        //
        // NEVER:
        // - commit the refresh token to GitHub
        // - send it in chat
        // - put it in frontend code
        // - expose it in browser JSON
        // ==================================================

        if (
            process.env.NODE_ENV === "development" &&
            process.env.SHOW_GOOGLE_REFRESH_TOKEN_ONCE ===
                "true" &&
            tokens.refresh_token
        ) {
            console.log("");
            console.log(
                "======================================================"
            );
            console.log(
                "⚠️ GOOGLE REFRESH TOKEN - LOCAL SETUP ONLY"
            );
            console.log(
                "======================================================"
            );

            console.log(
                `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`
            );

            console.log(
                "======================================================"
            );
            console.log(
                "⚠️ Copy this into .env immediately."
            );
            console.log(
                "⚠️ Then remove SHOW_GOOGLE_REFRESH_TOKEN_ONCE."
            );
            console.log(
                "⚠️ NEVER push this token to GitHub."
            );
            console.log(
                "======================================================"
            );
            console.log("");
        }

        // --------------------------------------------------
        // Safe logs
        //
        // We only log whether tokens were received.
        // --------------------------------------------------

        console.log("");
        console.log(
            "================================="
        );
        console.log(
            "✅ GOOGLE DRIVE CONNECTED"
        );
        console.log(
            "Access Token Received:",
            accessTokenReceived
        );
        console.log(
            "Refresh Token Received:",
            refreshTokenReceived
        );
        console.log(
            "================================="
        );
        console.log("");

        // --------------------------------------------------
        // IMPORTANT:
        // Actual tokens are NEVER returned to browser.
        // --------------------------------------------------

        return res.status(200).json({
            success: true,

            message:
                "Google Drive connected successfully ✅",

            accessTokenReceived,

            refreshTokenReceived,

            nextStep: refreshTokenReceived
                ? "Refresh token received. Store it securely as GOOGLE_REFRESH_TOKEN."
                : "Refresh token was not returned. Re-authorize using the Google consent screen.",
        });
    } catch (error) {
        console.error(
            "❌ Google Callback Error:",
            error.message
        );

        return res.status(500).json({
            success: false,

            message:
                "Google Drive authentication failed",

            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
});

// ======================================================
// TEST GOOGLE DRIVE CONNECTION
//
// GET /api/google-drive/test
// ======================================================

router.get("/test", async (req, res) => {
    try {
        const drive = getDriveClient();

        const response =
            await drive.files.list({
                pageSize: 10,

                fields:
                    "files(id,name,mimeType,createdTime,modifiedTime,size)",

                orderBy:
                    "createdTime desc",
            });

        const files =
            response.data.files || [];

        return res.status(200).json({
            success: true,

            message:
                "Google Drive API working correctly ✅",

            filesFound:
                files.length,

            files,
        });
    } catch (error) {
        console.error(
            "❌ Google Drive Test Error:",
            error.message
        );

        return res.status(500).json({
            success: false,

            message:
                "Google Drive connection test failed",

            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
});

// ======================================================
// GOOGLE DRIVE ABOUT / ACCOUNT TEST
//
// GET /api/google-drive/about
//
// Confirms that the stored refresh token can actually
// authenticate with Google Drive.
// ======================================================

router.get("/about", async (req, res) => {
    try {
        const drive = getDriveClient();

        const response =
            await drive.about.get({
                fields:
                    "user(displayName,emailAddress),storageQuota",
            });

        return res.status(200).json({
            success: true,

            message:
                "Google Drive authentication working correctly ✅",

            user: {
                displayName:
                    response.data.user?.displayName ||
                    null,

                emailAddress:
                    response.data.user?.emailAddress ||
                    null,
            },

            storageQuota:
                response.data.storageQuota || null,
        });
    } catch (error) {
        console.error(
            "❌ Google Drive About Error:",
            error.message
        );

        return res.status(500).json({
            success: false,

            message:
                "Unable to access Google Drive account",

            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
});

// ======================================================
// EXPORT HELPERS
//
// These can later be imported into upload routes,
// blog routes, backup services, etc.
// ======================================================

export {
    getOAuthClient,
    getDriveClient,
};

// ======================================================
// EXPORT ROUTER
// ======================================================

export default router;