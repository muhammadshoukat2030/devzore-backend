import express from "express";
import { google } from "googleapis";

const router = express.Router();

const DRIVE_SCOPE = [
  "https://www.googleapis.com/auth/drive.file",
];

let cachedOAuthClient = null;
let cachedRefreshToken = null;

// ENV HELPERS

const getEnvValue = (name) => {
  return String(process.env[name] || "").trim();
};

const requireEnvValue = (name) => {
  const value = getEnvValue(name);

  if (!value) {
    throw new Error(`${name} is missing`);
  }

  return value;
};

// GOOGLE ERROR HELPERS

const getGoogleErrorMessage = (error) => {
  const responseData = error?.response?.data;

  if (
    typeof responseData?.error_description === "string"
  ) {
    return responseData.error_description;
  }

  if (
    typeof responseData?.error?.message === "string"
  ) {
    return responseData.error.message;
  }

  if (typeof responseData?.error === "string") {
    return responseData.error;
  }

  return (
    error?.message ||
    "Unknown Google Drive error"
  );
};

const isInvalidGrantError = (error) => {
  const message =
    getGoogleErrorMessage(error).toLowerCase();

  return (
    message.includes("invalid_grant") ||
    message.includes("expired or revoked") ||
    message.includes("token has been expired") ||
    message.includes("token has been revoked")
  );
};

const createGoogleAuthError = (error) => {
  const message =
    getGoogleErrorMessage(error);

  if (isInvalidGrantError(error)) {
    const authError = new Error(
      "Google Drive refresh token is invalid, expired or revoked. Re-authorize Google Drive and replace GOOGLE_REFRESH_TOKEN."
    );

    authError.code =
      "GOOGLE_DRIVE_AUTH_REQUIRED";

    authError.originalMessage =
      message;

    return authError;
  }

  const driveError = new Error(message);

  driveError.code =
    "GOOGLE_DRIVE_ERROR";

  return driveError;
};

// CREATE OAUTH CLIENT

const createOAuthClient = () => {
  const clientId =
    requireEnvValue(
      "GOOGLE_CLIENT_ID"
    );

  const clientSecret =
    requireEnvValue(
      "GOOGLE_CLIENT_SECRET"
    );

  const redirectUri =
    requireEnvValue(
      "GOOGLE_REDIRECT_URI"
    );

  const oauth2Client =
    new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

  oauth2Client.on(
    "tokens",
    (tokens) => {
      if (tokens.access_token) {
        console.log(
          "🔄 Google access token refreshed automatically"
        );
      }

      if (tokens.refresh_token) {
        console.log(
          "⚠️ Google issued a new refresh token."
        );

        console.log(
          "⚠️ Replace GOOGLE_REFRESH_TOKEN in your secure environment."
        );
      }
    }
  );

  return oauth2Client;
};

// GET OAUTH CLIENT

const getOAuthClient = ({
  attachRefreshToken = true,
  forceNew = false,
} = {}) => {
  if (forceNew || !cachedOAuthClient) {
    cachedOAuthClient =
      createOAuthClient();

    cachedRefreshToken = null;
  }

  if (attachRefreshToken) {
    const refreshToken =
      getEnvValue(
        "GOOGLE_REFRESH_TOKEN"
      );

    if (refreshToken) {
      if (
        cachedRefreshToken !==
        refreshToken
      ) {
        cachedOAuthClient.setCredentials({
          ...cachedOAuthClient.credentials,
          refresh_token:
            refreshToken,
        });

        cachedRefreshToken =
          refreshToken;
      }
    }
  }

  return cachedOAuthClient;
};

// CALLBACK CLIENT
//
// OAuth callback ke liye separate client.
// Existing cached Drive client disturb nahi hoga.

const createCallbackOAuthClient = () => {
  return createOAuthClient();
};

// DRIVE CLIENT

const getDriveClient = () => {
  const refreshToken =
    getEnvValue(
      "GOOGLE_REFRESH_TOKEN"
    );

  if (!refreshToken) {
    const error = new Error(
      "GOOGLE_REFRESH_TOKEN is missing. Complete Google Drive OAuth setup first."
    );

    error.code =
      "GOOGLE_DRIVE_AUTH_REQUIRED";

    throw error;
  }

  const oauth2Client =
    getOAuthClient({
      attachRefreshToken: true,
    });

  return google.drive({
    version: "v3",
    auth: oauth2Client,
  });
};

// TEST ACCESS TOKEN

const verifyGoogleAccess = async () => {
  try {
    const oauth2Client =
      getOAuthClient({
        attachRefreshToken: true,
      });

    const refreshToken =
      getEnvValue(
        "GOOGLE_REFRESH_TOKEN"
      );

    if (!refreshToken) {
      const error = new Error(
        "GOOGLE_REFRESH_TOKEN is missing."
      );

      error.code =
        "GOOGLE_DRIVE_AUTH_REQUIRED";

      throw error;
    }

    // Google library refresh token use karke
    // access token automatically generate/refresh karegi.
    const result =
      await oauth2Client.getAccessToken();

    const accessToken =
      typeof result === "string"
        ? result
        : result?.token;

    if (!accessToken) {
      throw new Error(
        "Google did not return an access token."
      );
    }

    return true;
  } catch (error) {
    throw createGoogleAuthError(
      error
    );
  }
};

// DRIVE CONNECTION TEST

const verifyGoogleDriveConnection =
  async () => {
    try {
      await verifyGoogleAccess();

      const drive =
        getDriveClient();

      const response =
        await drive.about.get({
          fields:
            "user(displayName,emailAddress)",
        });

      return {
        connected: true,

        user: {
          displayName:
            response.data.user
              ?.displayName ||
            null,

          emailAddress:
            response.data.user
              ?.emailAddress ||
            null,
        },
      };
    } catch (error) {
      if (
        error?.code ===
        "GOOGLE_DRIVE_AUTH_REQUIRED"
      ) {
        throw error;
      }

      throw createGoogleAuthError(
        error
      );
    }
  };

// STATUS

router.get(
  "/status",
  async (req, res) => {
    try {
      const clientIdConfigured =
        Boolean(
          getEnvValue(
            "GOOGLE_CLIENT_ID"
          )
        );

      const clientSecretConfigured =
        Boolean(
          getEnvValue(
            "GOOGLE_CLIENT_SECRET"
          )
        );

      const redirectUriConfigured =
        Boolean(
          getEnvValue(
            "GOOGLE_REDIRECT_URI"
          )
        );

      const refreshTokenConfigured =
        Boolean(
          getEnvValue(
            "GOOGLE_REFRESH_TOKEN"
          )
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

        configured:
          oauthConfigured,

        refreshTokenConfigured,

        fullyConfigured,

        message: fullyConfigured
          ? "Google Drive configuration is complete."
          : oauthConfigured
            ? "Google OAuth is configured, but GOOGLE_REFRESH_TOKEN is missing."
            : "Google Drive OAuth configuration is incomplete.",
      });
    } catch (error) {
      console.error(
        "❌ Google Drive Status Error:",
        error.message
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to check Google Drive configuration.",
      });
    }
  }
);

// START AUTH

router.get(
  "/auth",
  (req, res) => {
    try {
      const oauth2Client =
        createCallbackOAuthClient();

      const authUrl =
        oauth2Client.generateAuthUrl({
          access_type: "offline",

          prompt: "consent",

          scope: DRIVE_SCOPE,

          include_granted_scopes:
            true,
        });

      return res.redirect(
        authUrl
      );
    } catch (error) {
      console.error(
        "❌ Google Auth Error:",
        error.message
      );

      return res.status(500).json({
        success: false,

        message:
          "Failed to start Google Drive authentication.",

        error:
          process.env.NODE_ENV ===
          "development"
            ? error.message
            : undefined,
      });
    }
  }
);

// OAUTH CALLBACK

router.get(
  "/callback",
  async (req, res) => {
    try {
      const {
        code,
        error: googleError,
      } = req.query;

      if (googleError) {
        return res.status(400).json({
          success: false,

          message:
            "Google authorization was denied.",

          error:
            googleError,
        });
      }

      if (!code) {
        return res.status(400).json({
          success: false,

          message:
            "Google authorization code is missing.",
        });
      }

      const oauth2Client =
        createCallbackOAuthClient();

      const { tokens } =
        await oauth2Client.getToken(
          code
        );

      if (!tokens) {
        throw new Error(
          "Google did not return OAuth tokens."
        );
      }

      oauth2Client.setCredentials(
        tokens
      );

      const accessTokenReceived =
        Boolean(
          tokens.access_token
        );

      const refreshTokenReceived =
        Boolean(
          tokens.refresh_token
        );

      // Verify newly authorized account immediately.
      const callbackDrive =
        google.drive({
          version: "v3",
          auth: oauth2Client,
        });

      let connectedEmail = null;

      try {
        const aboutResponse =
          await callbackDrive.about.get({
            fields:
              "user(displayName,emailAddress)",
          });

        connectedEmail =
          aboutResponse.data.user
            ?.emailAddress ||
          null;
      } catch (verifyError) {
        console.error(
          "⚠️ OAuth succeeded but Drive verification failed:",
          getGoogleErrorMessage(
            verifyError
          )
        );
      }

      // LOCAL ONLY:
      // temporarily apply new token to current Node process.
      //
      // .env mein phir bhi manually save karna hoga.
      if (
        process.env.NODE_ENV ===
          "development" &&
        tokens.refresh_token
      ) {
        process.env.GOOGLE_REFRESH_TOKEN =
          tokens.refresh_token;

        cachedOAuthClient = null;
        cachedRefreshToken = null;

        console.log(
          "✅ New Google refresh token applied to current local process."
        );
      }

      // Optional one-time local terminal display.
      if (
        process.env.NODE_ENV ===
          "development" &&
        getEnvValue(
          "SHOW_GOOGLE_REFRESH_TOKEN_ONCE"
        ) === "true" &&
        tokens.refresh_token
      ) {
        console.log("");
        console.log(
          "=============================================="
        );
        console.log(
          "⚠️ GOOGLE REFRESH TOKEN - LOCAL SETUP ONLY"
        );
        console.log(
          "=============================================="
        );

        console.log(
          `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`
        );

        console.log(
          "=============================================="
        );
        console.log(
          "Copy it into backend .env."
        );
        console.log(
          "Then remove SHOW_GOOGLE_REFRESH_TOKEN_ONCE=true."
        );
        console.log(
          "Never commit this token to GitHub."
        );
        console.log(
          "=============================================="
        );
        console.log("");
      }

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

      if (connectedEmail) {
        console.log(
          "Connected Account:",
          connectedEmail
        );
      }

      console.log(
        "================================="
      );
      console.log("");

      return res.status(200).json({
        success: true,

        message:
          "Google Drive connected successfully.",

        accessTokenReceived,

        refreshTokenReceived,

        accountVerified:
          Boolean(
            connectedEmail
          ),

        nextStep:
          refreshTokenReceived
            ? "New refresh token received. Save it as GOOGLE_REFRESH_TOKEN in local and deployed environment variables."
            : "No new refresh token was returned. If the existing token is invalid, revoke the app permission and authorize again.",
      });
    } catch (error) {
      console.error(
        "❌ Google Callback Error:",
        getGoogleErrorMessage(
          error
        )
      );

      const normalizedError =
        createGoogleAuthError(
          error
        );

      return res.status(500).json({
        success: false,

        code:
          normalizedError.code,

        message:
          normalizedError.message,

        error:
          process.env.NODE_ENV ===
          "development"
            ? normalizedError.originalMessage ||
              normalizedError.message
            : undefined,
      });
    }
  }
);

// TEST CONNECTION

router.get(
  "/test",
  async (req, res) => {
    try {
      const connection =
        await verifyGoogleDriveConnection();

      const drive =
        getDriveClient();

      const response =
        await drive.files.list({
          pageSize: 10,

          fields:
            "files(id,name,mimeType,createdTime,modifiedTime,size)",

          orderBy:
            "createdTime desc",
        });

      const files =
        response.data.files ||
        [];

      return res.status(200).json({
        success: true,

        message:
          "Google Drive API is working correctly.",

        authenticated: true,

        user:
          connection.user,

        filesFound:
          files.length,

        files,
      });
    } catch (error) {
      console.error(
        "❌ Google Drive Test Error:",
        getGoogleErrorMessage(
          error
        )
      );

      const normalizedError =
        error?.code ===
        "GOOGLE_DRIVE_AUTH_REQUIRED"
          ? error
          : createGoogleAuthError(
              error
            );

      const authRequired =
        normalizedError.code ===
        "GOOGLE_DRIVE_AUTH_REQUIRED";

      return res
        .status(
          authRequired
            ? 401
            : 500
        )
        .json({
          success: false,

          code:
            normalizedError.code,

          message:
            authRequired
              ? "Google Drive authorization is invalid or expired. Reconnect Google Drive."
              : "Google Drive connection test failed.",

          error:
            process.env.NODE_ENV ===
            "development"
              ? normalizedError.message
              : undefined,

          reconnectUrl:
            authRequired
              ? "/api/google-drive/auth"
              : undefined,
        });
    }
  }
);

// ABOUT

router.get(
  "/about",
  async (req, res) => {
    try {
      await verifyGoogleAccess();

      const drive =
        getDriveClient();

      const response =
        await drive.about.get({
          fields:
            "user(displayName,emailAddress),storageQuota",
        });

      return res.status(200).json({
        success: true,

        message:
          "Google Drive authentication is working correctly.",

        authenticated: true,

        user: {
          displayName:
            response.data.user
              ?.displayName ||
            null,

          emailAddress:
            response.data.user
              ?.emailAddress ||
            null,
        },

        storageQuota:
          response.data
            .storageQuota ||
          null,
      });
    } catch (error) {
      console.error(
        "❌ Google Drive About Error:",
        getGoogleErrorMessage(
          error
        )
      );

      const normalizedError =
        error?.code ===
        "GOOGLE_DRIVE_AUTH_REQUIRED"
          ? error
          : createGoogleAuthError(
              error
            );

      const authRequired =
        normalizedError.code ===
        "GOOGLE_DRIVE_AUTH_REQUIRED";

      return res
        .status(
          authRequired
            ? 401
            : 500
        )
        .json({
          success: false,

          code:
            normalizedError.code,

          message:
            authRequired
              ? "Google Drive needs to be re-authorized."
              : "Unable to access Google Drive account.",

          error:
            process.env.NODE_ENV ===
            "development"
              ? normalizedError.message
              : undefined,
        });
    }
  }
);

// TOKEN HEALTH CHECK

router.get(
  "/health",
  async (req, res) => {
    try {
      const connection =
        await verifyGoogleDriveConnection();

      return res.status(200).json({
        success: true,

        connected: true,

        refreshTokenConfigured:
          true,

        user:
          connection.user,

        message:
          "Google Drive OAuth is healthy.",
      });
    } catch (error) {
      const normalizedError =
        error?.code ===
        "GOOGLE_DRIVE_AUTH_REQUIRED"
          ? error
          : createGoogleAuthError(
              error
            );

      return res.status(401).json({
        success: false,

        connected: false,

        code:
          normalizedError.code,

        message:
          normalizedError.message,

        reconnectUrl:
          "/api/google-drive/auth",
      });
    }
  }
);

// EXPORTS

export {
  getOAuthClient,
  getDriveClient,
  verifyGoogleAccess,
  verifyGoogleDriveConnection,
};

export default router;