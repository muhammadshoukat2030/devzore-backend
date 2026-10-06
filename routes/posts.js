import express from "express";
import mongoose from "mongoose";
import { body, validationResult } from "express-validator";

import Post from "../models/Post.js";
import Category from "../models/Category.js";
import { protect, adminOnly } from "../middleware/auth.js";
import { getDriveClient } from "./googleDrive.js";

const router = express.Router();

// CONFIG

const DRIVE_FILE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

const ALLOWED_STATUSES = [
  "draft",
  "published",
  "scheduled",
];

const SORT_OPTIONS = {
  "-publishedAt": {
    publishedAt: -1,
  },

  publishedAt: {
    publishedAt: 1,
  },

  "-createdAt": {
    createdAt: -1,
  },

  createdAt: {
    createdAt: 1,
  },

  "-updatedAt": {
    updatedAt: -1,
  },

  updatedAt: {
    updatedAt: 1,
  },
};

// PAGINATION

const getPagination = (
  page,
  limit
) => {
  const parsedPage = Math.max(
    Number(page) || 1,
    1
  );

  const parsedLimit = Math.min(
    Math.max(
      Number(limit) || 10,
      1
    ),
    100
  );

  return {
    page: parsedPage,
    limit: parsedLimit,

    skip:
      (parsedPage - 1) *
      parsedLimit,
  };
};

// SORT

const getSort = (value) => {
  return (
    SORT_OPTIONS[value] ||
    SORT_OPTIONS["-publishedAt"]
  );
};

// REGEX ESCAPE

const escapeRegExp = (
  value = ""
) => {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
};

// DRIVE IMAGE URL

/*
 * Public blog images ko render karne ke liye
 * backend OAuth proxy ki zarurat nahi honi chahiye.
 *
 * File upload ke waqt Drive permission "anyone reader"
 * honi chahiye.
 */
const createGoogleDriveImageUrl = (
  fileId
) => {
  if (!fileId) {
    return "";
  }

  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(
    fileId
  )}`;
};

// EXTRACT DRIVE FILE ID

const extractDriveFileIdFromUrl = (
  value = ""
) => {
  if (
    !value ||
    typeof value !== "string"
  ) {
    return "";
  }

  const url = value.trim();

  if (!url) {
    return "";
  }

  // Backend proxy URL:
  // /api/upload/image/FILE_ID

  const proxyMatch = url.match(
    /\/api\/upload\/image\/([a-zA-Z0-9_-]+)/i
  );

  if (
    proxyMatch?.[1] &&
    DRIVE_FILE_ID_REGEX.test(
      proxyMatch[1]
    )
  ) {
    return proxyMatch[1];
  }

  // Google Drive file page:
  // drive.google.com/file/d/FILE_ID/view

  const fileMatch = url.match(
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i
  );

  if (
    fileMatch?.[1] &&
    DRIVE_FILE_ID_REGEX.test(
      fileMatch[1]
    )
  ) {
    return fileMatch[1];
  }

  // Googleusercontent:
  // lh3.googleusercontent.com/d/FILE_ID

  const googleusercontentMatch =
    url.match(
      /googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i
    );

  if (
    googleusercontentMatch?.[1] &&
    DRIVE_FILE_ID_REGEX.test(
      googleusercontentMatch[1]
    )
  ) {
    return googleusercontentMatch[1];
  }

  // Google Drive ?id=FILE_ID

  if (
    url.includes(
      "drive.google.com"
    )
  ) {
    const queryMatch = url.match(
      /[?&]id=([a-zA-Z0-9_-]+)/i
    );

    if (
      queryMatch?.[1] &&
      DRIVE_FILE_ID_REGEX.test(
        queryMatch[1]
      )
    ) {
      return queryMatch[1];
    }
  }

  return "";
};

// NORMALIZE IMAGE URL

const normalizeImageUrl = (
  imageUrl = "",
  publicId = ""
) => {
  const cleanPublicId =
    String(publicId || "").trim();

  if (
    cleanPublicId &&
    DRIVE_FILE_ID_REGEX.test(
      cleanPublicId
    )
  ) {
    return createGoogleDriveImageUrl(
      cleanPublicId
    );
  }

  const extractedId =
    extractDriveFileIdFromUrl(
      imageUrl
    );

  if (extractedId) {
    return createGoogleDriveImageUrl(
      extractedId
    );
  }

  return String(
    imageUrl || ""
  ).trim();
};

// NORMALIZE CONTENT IMAGE URLS

/*
 * Purane posts mein:
 *
 * http://localhost:5000/api/upload/image/FILE_ID
 *
 * ya deployed backend proxy URL stored ho sakta hai.
 *
 * Public article response mein us URL ko direct
 * Google Drive public image URL mein convert kar denge.
 *
 * Is se normal image rendering access token par
 * depend nahi karegi.
 */
const normalizeContentImageUrls = (
  html = ""
) => {
  if (
    !html ||
    typeof html !== "string"
  ) {
    return html || "";
  }

  let normalized = html;

  // Absolute backend proxy URL

  normalized =
    normalized.replace(
      /https?:\/\/[^"'<> \s]+\/api\/upload\/image\/([a-zA-Z0-9_-]+)/gi,
      (
        match,
        fileId
      ) =>
        createGoogleDriveImageUrl(
          fileId
        )
    );

  // Relative backend proxy URL

  normalized =
    normalized.replace(
      /\/api\/upload\/image\/([a-zA-Z0-9_-]+)/gi,
      (
        match,
        fileId
      ) =>
        createGoogleDriveImageUrl(
          fileId
        )
    );

  return normalized;
};

// SERIALIZE POST

const serializePost = (
  post,
  {
    normalizeContent = true,
  } = {}
) => {
  if (!post) {
    return null;
  }

  const object =
    typeof post.toObject ===
    "function"
      ? post.toObject()
      : { ...post };

  object.coverImage =
    normalizeImageUrl(
      object.coverImage,
      object.coverImagePublicId
    );

  if (
    normalizeContent &&
    object.content
  ) {
    object.content =
      normalizeContentImageUrls(
        object.content
      );
  }

  return object;
};

// EXTRACT DRIVE IDS FROM CONTENT

const extractDriveFileIdsFromContent =
  (html = "") => {
    const fileIds =
      new Set();

    if (
      !html ||
      typeof html !== "string"
    ) {
      return [];
    }

    // data-public-id="FILE_ID"

    const publicIdRegex =
      /data-public-id\s*=\s*["']([a-zA-Z0-9_-]+)["']/gi;

    let match;

    while (
      (match =
        publicIdRegex.exec(
          html
        )) !== null
    ) {
      const fileId =
        match?.[1];

      if (
        fileId &&
        DRIVE_FILE_ID_REGEX.test(
          fileId
        )
      ) {
        fileIds.add(fileId);
      }
    }

    // Backend proxy URLs

    const proxyRegex =
      /\/api\/upload\/image\/([a-zA-Z0-9_-]+)/gi;

    while (
      (match =
        proxyRegex.exec(
          html
        )) !== null
    ) {
      const fileId =
        match?.[1];

      if (
        fileId &&
        DRIVE_FILE_ID_REGEX.test(
          fileId
        )
      ) {
        fileIds.add(fileId);
      }
    }

    // Google Drive file URLs

    const driveFileRegex =
      /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/gi;

    while (
      (match =
        driveFileRegex.exec(
          html
        )) !== null
    ) {
      const fileId =
        match?.[1];

      if (
        fileId &&
        DRIVE_FILE_ID_REGEX.test(
          fileId
        )
      ) {
        fileIds.add(fileId);
      }
    }

    // Googleusercontent URLs

    const googleusercontentRegex =
      /googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/gi;

    while (
      (match =
        googleusercontentRegex.exec(
          html
        )) !== null
    ) {
      const fileId =
        match?.[1];

      if (
        fileId &&
        DRIVE_FILE_ID_REGEX.test(
          fileId
        )
      ) {
        fileIds.add(fileId);
      }
    }

    // drive.google.com URLs containing ?id=

    const driveQueryRegex =
      /drive\.google\.com\/[^"'<>]*?[?&]id=([a-zA-Z0-9_-]+)/gi;

    while (
      (match =
        driveQueryRegex.exec(
          html
        )) !== null
    ) {
      const fileId =
        match?.[1];

      if (
        fileId &&
        DRIVE_FILE_ID_REGEX.test(
          fileId
        )
      ) {
        fileIds.add(fileId);
      }
    }

    return [
      ...fileIds,
    ];
  };

// GET ALL DRIVE IDS USED BY POST

const getPostDriveFileIds = (
  post
) => {
  const fileIds =
    new Set();

  if (!post) {
    return [];
  }

  const coverPublicId =
    String(
      post.coverImagePublicId ||
        ""
    ).trim();

  if (
    coverPublicId &&
    DRIVE_FILE_ID_REGEX.test(
      coverPublicId
    )
  ) {
    fileIds.add(
      coverPublicId
    );
  }

  const coverUrlId =
    extractDriveFileIdFromUrl(
      post.coverImage || ""
    );

  if (coverUrlId) {
    fileIds.add(
      coverUrlId
    );
  }

  extractDriveFileIdsFromContent(
    post.content || ""
  ).forEach((fileId) => {
    fileIds.add(fileId);
  });

  return [
    ...fileIds,
  ];
};

// CHECK DRIVE FILE USAGE

const isDriveFileUsedElsewhere =
  async (
    fileId,
    excludePostId = null
  ) => {
    if (
      !fileId ||
      !DRIVE_FILE_ID_REGEX.test(
        fileId
      )
    ) {
      return false;
    }

    const safeId =
      escapeRegExp(fileId);

    const filter = {
      $or: [
        {
          coverImagePublicId:
            fileId,
        },

        {
          coverImage: {
            $regex: safeId,
          },
        },

        {
          content: {
            $regex: safeId,
          },
        },
      ],
    };

    if (excludePostId) {
      filter._id = {
        $ne: excludePostId,
      };
    }

    const exists =
      await Post.exists(
        filter
      );

    return Boolean(exists);
  };

// DELETE DRIVE FILES SAFELY

const cleanupDriveFiles =
  async (
    fileIds = [],
    excludePostId = null
  ) => {
    const uniqueIds = [
      ...new Set(
        fileIds.filter(
          (fileId) =>
            fileId &&
            DRIVE_FILE_ID_REGEX.test(
              fileId
            )
        )
      ),
    ];

    const result = {
      deleted: [],
      skipped: [],
      failed: [],
    };

    if (
      uniqueIds.length === 0
    ) {
      return result;
    }

    let drive;

    try {
      drive =
        getDriveClient();
    } catch (error) {
      console.error(
        "❌ Google Drive client unavailable:",
        error.message
      );

      result.failed =
        uniqueIds.map(
          (fileId) => ({
            fileId,
            message:
              error.message,
          })
        );

      return result;
    }

    for (
      const fileId of uniqueIds
    ) {
      try {
        const usedElsewhere =
          await isDriveFileUsedElsewhere(
            fileId,
            excludePostId
          );

        if (usedElsewhere) {
          result.skipped.push(
            fileId
          );

          continue;
        }

        await drive.files.delete(
          {
            fileId,
          }
        );

        result.deleted.push(
          fileId
        );

        console.log(
          "🗑️ Google Drive image deleted:",
          fileId
        );
      } catch (error) {
        const status =
          Number(
            error?.code ||
              error?.response
                ?.status
          );

        // File already missing.
        // Treat as cleaned.

        if (status === 404) {
          result.deleted.push(
            fileId
          );

          console.warn(
            "⚠️ Google Drive image already missing:",
            fileId
          );

          continue;
        }

        console.error(
          "❌ Google Drive cleanup failed:",
          fileId,
          error?.message
        );

        result.failed.push({
          fileId,

          message:
            error?.message ||
            "Drive deletion failed",
        });
      }
    }

    return result;
  };

// CATEGORY COUNT

const incrementCategoryCount =
  async (
    categoryId
  ) => {
    if (!categoryId) {
      return;
    }

    await Category.findByIdAndUpdate(
      categoryId,
      {
        $inc: {
          postCount: 1,
        },
      }
    );
  };

const decrementCategoryCount =
  async (
    categoryId
  ) => {
    if (!categoryId) {
      return;
    }

    /*
     * postCount ko negative nahi hone dena.
     */
    await Category.updateOne(
      {
        _id: categoryId,
        postCount: {
          $gt: 0,
        },
      },
      {
        $inc: {
          postCount: -1,
        },
      }
    );
  };

// SYNC CATEGORY COUNTS

const syncCategoryPostCounts =
  async ({
    oldCategoryId,
    newCategoryId,
    wasPublished,
    isPublished,
  }) => {
    const oldId =
      oldCategoryId
        ? String(
            oldCategoryId
          )
        : "";

    const newId =
      newCategoryId
        ? String(
            newCategoryId
          )
        : "";

    const categoryChanged =
      Boolean(
        oldId &&
          newId &&
          oldId !== newId
      );

    // Published -> not published

    if (
      wasPublished &&
      !isPublished
    ) {
      await decrementCategoryCount(
        oldId
      );

      return;
    }

    // Not published -> published

    if (
      !wasPublished &&
      isPublished
    ) {
      await incrementCategoryCount(
        newId
      );

      return;
    }

    // Published and category changed

    if (
      wasPublished &&
      isPublished &&
      categoryChanged
    ) {
      await decrementCategoryCount(
        oldId
      );

      await incrementCategoryCount(
        newId
      );
    }
  };

// NORMALIZE TAGS

const normalizeTags = (
  value
) => {
  if (
    Array.isArray(value)
  ) {
    return [
      ...new Set(
        value
          .map((tag) =>
            String(tag || "")
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      ),
    ];
  }

  if (
    typeof value ===
    "string"
  ) {
    return [
      ...new Set(
        value
          .split(",")
          .map((tag) =>
            tag
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      ),
    ];
  }

  return [];
};

// APPLY SAFE POST INPUT

/*
 * req.body ko direct spread nahi karna.
 *
 * Is se visitor/admin request author, views, likes,
 * createdAt etc. overwrite nahi kar sakti.
 */
const applyPostInput = (
  post,
  data = {}
) => {
  const has = (key) =>
    Object.prototype.hasOwnProperty.call(
      data,
      key
    );

  if (has("title")) {
    post.title =
      String(
        data.title || ""
      ).trim();
  }

  if (has("slug")) {
    post.slug =
      String(
        data.slug || ""
      ).trim();
  }

  if (has("excerpt")) {
    post.excerpt =
      String(
        data.excerpt || ""
      ).trim();
  }

  if (has("content")) {
    post.content =
      String(
        data.content || ""
      );
  }

  if (has("coverImage")) {
    post.coverImage =
      String(
        data.coverImage || ""
      ).trim();
  }

  if (
    has(
      "coverImagePublicId"
    )
  ) {
    post.coverImagePublicId =
      String(
        data.coverImagePublicId ||
          ""
      ).trim();
  }

  if (has("coverImageAlt")) {
    post.coverImageAlt =
      String(
        data.coverImageAlt ||
          ""
      ).trim();
  }

  if (has("category")) {
    post.category =
      data.category;
  }

  if (has("status")) {
    post.status =
      data.status;
  }

  if (has("scheduledAt")) {
    post.scheduledAt =
      data.scheduledAt ||
      null;
  }

  if (has("featured")) {
    post.featured =
      data.featured === true ||
      data.featured ===
        "true";
  }

  if (has("tags")) {
    post.tags =
      normalizeTags(
        data.tags
      );
  }

  if (has("seoTitle")) {
    post.seoTitle =
      String(
        data.seoTitle || ""
      ).trim();
  }

  if (
    has(
      "seoDescription"
    )
  ) {
    post.seoDescription =
      String(
        data.seoDescription ||
          ""
      ).trim();
  }

  if (
    has(
      "seoKeywords"
    )
  ) {
    post.seoKeywords =
      String(
        data.seoKeywords ||
          ""
      ).trim();
  }

  if (
    has(
      "tableOfContents"
    ) &&
    Array.isArray(
      data.tableOfContents
    )
  ) {
    post.tableOfContents =
      data.tableOfContents;
  }
};

// VALIDATION

const postValidation = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage(
      "Title is required."
    )
    .isLength({
      max: 200,
    })
    .withMessage(
      "Title cannot exceed 200 characters."
    ),

  body("slug")
    .optional({
      checkFalsy: true,
    })
    .trim()
    .isLength({
      max: 220,
    })
    .withMessage(
      "Slug cannot exceed 220 characters."
    ),

  body("excerpt")
    .trim()
    .notEmpty()
    .withMessage(
      "Excerpt is required."
    )
    .isLength({
      max: 300,
    })
    .withMessage(
      "Excerpt cannot exceed 300 characters."
    ),

  body("content")
    .custom((value) => {
      if (
        typeof value !==
          "string" ||
        !value.trim()
      ) {
        throw new Error(
          "Content is required."
        );
      }

      return true;
    }),

  body("category")
    .notEmpty()
    .withMessage(
      "Category is required."
    )
    .custom((value) => {
      if (
        !mongoose.Types.ObjectId.isValid(
          value
        )
      ) {
        throw new Error(
          "Invalid category ID."
        );
      }

      return true;
    }),

  body("status")
    .optional()
    .isIn(
      ALLOWED_STATUSES
    )
    .withMessage(
      "Invalid post status."
    ),

  body("scheduledAt")
    .optional({
      nullable: true,
      checkFalsy: true,
    })
    .custom((value) => {
      if (
        value &&
        Number.isNaN(
          new Date(
            value
          ).getTime()
        )
      ) {
        throw new Error(
          "Invalid scheduled date."
        );
      }

      return true;
    }),

  body("seoTitle")
    .optional()
    .isLength({
      max: 70,
    })
    .withMessage(
      "SEO title cannot exceed 70 characters."
    ),

  body("seoDescription")
    .optional()
    .isLength({
      max: 160,
    })
    .withMessage(
      "SEO description cannot exceed 160 characters."
    ),

  body("coverImageAlt")
    .optional()
    .isLength({
      max: 200,
    })
    .withMessage(
      "Cover image alt text cannot exceed 200 characters."
    ),
];

// VALIDATION RESULT

const sendValidationErrors = (
  req,
  res
) => {
  const errors =
    validationResult(req);

  if (
    !errors.isEmpty()
  ) {
    res.status(400).json({
      success: false,
      message:
        errors.array()[0]
          ?.msg ||
        "Validation failed.",
      errors:
        errors.array(),
    });

    return true;
  }

  if (
    req.body.status ===
      "scheduled" &&
    !req.body.scheduledAt
  ) {
    res.status(400).json({
      success: false,
      message:
        "Scheduled publish date and time is required.",
    });

    return true;
  }

  return false;
};

// ERROR RESPONSE

const sendPostError = (
  res,
  error,
  fallbackMessage
) => {
  // Duplicate slug

  if (
    error?.code ===
    11000
  ) {
    return res
      .status(409)
      .json({
        success: false,

        message:
          "This slug is already being used by another post. Please use a different slug.",
      });
  }

  // Mongoose validation

  if (
    error?.name ===
    "ValidationError"
  ) {
    const messages =
      Object.values(
        error.errors || {}
      )
        .map(
          (item) =>
            item?.message
        )
        .filter(Boolean);

    return res
      .status(400)
      .json({
        success: false,

        message:
          messages[0] ||
          "Post validation failed.",

        errors:
          messages,
      });
  }

  // Invalid ObjectId

  if (
    error?.name ===
    "CastError"
  ) {
    return res
      .status(400)
      .json({
        success: false,

        message:
          "Invalid post or category ID.",
      });
  }

  return res
    .status(500)
    .json({
      success: false,

      message:
        error?.message ||
        fallbackMessage,
    });
};

// GET /api/posts

router.get(
  "/",
  async (req, res) => {
    try {
      const {
        category,
        tag,
        search,
        featured,
        page = 1,
        limit = 10,
        sort = "-publishedAt",
      } = req.query;

      const {
        page: currentPage,
        limit: currentLimit,
        skip,
      } = getPagination(
        page,
        limit
      );

      const filter = {
        status: "published",
      };

      // Category

      if (category) {
        const categorySlug =
          String(category)
            .trim()
            .toLowerCase();

        const cat =
          await Category.findOne({
            slug: categorySlug,
          }).select("_id");

        if (!cat) {
          return res.json({
            success: true,

            data: [],

            pagination: {
              total: 0,
              page: currentPage,
              pages: 0,
              limit:
                currentLimit,
            },
          });
        }

        filter.category =
          cat._id;
      }

      // Tag

      if (tag) {
        filter.tags = {
          $in: [
            String(tag)
              .trim()
              .toLowerCase(),
          ],
        };
      }

      // Featured

      if (
        featured === "true"
      ) {
        filter.featured =
          true;
      }

      // Search

      if (
        search &&
        String(search).trim()
      ) {
        filter.$text = {
          $search:
            String(
              search
            ).trim(),
        };
      }

      const total =
        await Post.countDocuments(
          filter
        );

      const posts =
        await Post.find(
          filter
        )
          .populate(
            "author",
            "name avatar bio"
          )
          .populate(
            "category",
            "name slug color"
          )
          .select(
            "-content -tableOfContents"
          )
          .sort(
            getSort(sort)
          )
          .skip(skip)
          .limit(
            currentLimit
          )
          .lean();

      const data =
        posts.map(
          (post) =>
            serializePost(
              post,
              {
                normalizeContent:
                  false,
              }
            )
        );

      return res.json({
        success: true,

        data,

        pagination: {
          total,

          page:
            currentPage,

          pages:
            Math.ceil(
              total /
                currentLimit
            ),

          limit:
            currentLimit,
        },
      });
    } catch (error) {
      console.error(
        "Get posts error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to fetch posts."
      );
    }
  }
);

// GET /api/posts/featured

router.get(
  "/featured",
  async (req, res) => {
    try {
      const posts =
        await Post.find({
          status: "published",
          featured: true,
        })
          .populate(
            "author",
            "name avatar"
          )
          .populate(
            "category",
            "name slug color"
          )
          .select(
            "-content -tableOfContents"
          )
          .sort({
            publishedAt: -1,
          })
          .limit(6)
          .lean();

      return res.json({
        success: true,

        data: posts.map(
          (post) =>
            serializePost(
              post,
              {
                normalizeContent:
                  false,
              }
            )
        ),
      });
    } catch (error) {
      console.error(
        "Get featured posts error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to fetch featured posts."
      );
    }
  }
);

// GET /api/posts/latest

router.get(
  "/latest",
  async (req, res) => {
    try {
      const posts =
        await Post.find({
          status: "published",
        })
          .populate(
            "author",
            "name avatar"
          )
          .populate(
            "category",
            "name slug color"
          )
          .select(
            "-content -tableOfContents"
          )
          .sort({
            publishedAt: -1,
          })
          .limit(3)
          .lean();

      return res.json({
        success: true,

        data: posts.map(
          (post) =>
            serializePost(
              post,
              {
                normalizeContent:
                  false,
              }
            )
        ),
      });
    } catch (error) {
      console.error(
        "Get latest posts error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to fetch latest posts."
      );
    }
  }
);

// GET /api/posts/admin/all

router.get(
  "/admin/all",
  protect,
  adminOnly,

  async (req, res) => {
    try {
      const {
        status,
        search,
        page = 1,
        limit = 10,
      } = req.query;

      const {
        page: currentPage,
        limit: currentLimit,
        skip,
      } = getPagination(
        page,
        limit
      );

      const filter = {};

      if (
        status &&
        ALLOWED_STATUSES.includes(
          status
        )
      ) {
        filter.status =
          status;
      }

      if (
        search &&
        String(search).trim()
      ) {
        const safeSearch =
          String(search)
            .trim()
            .replace(
              /[^a-zA-Z0-9 _-]/g,
              ""
            );

        if (safeSearch) {
          filter.$or = [
            {
              title: {
                $regex:
                  safeSearch,

                $options:
                  "i",
              },
            },

            {
              slug: {
                $regex:
                  safeSearch,

                $options:
                  "i",
              },
            },
          ];
        }
      }

      const total =
        await Post.countDocuments(
          filter
        );

      const posts =
        await Post.find(
          filter
        )
          .populate(
            "author",
            "name avatar"
          )
          .populate(
            "category",
            "name slug color"
          )
          .select(
            "-content -tableOfContents"
          )
          .sort({
            createdAt: -1,
          })
          .skip(skip)
          .limit(
            currentLimit
          )
          .lean();

      return res.json({
        success: true,

        data: posts.map(
          (post) =>
            serializePost(
              post,
              {
                normalizeContent:
                  false,
              }
            )
        ),

        pagination: {
          total,

          page:
            currentPage,

          pages:
            Math.ceil(
              total /
                currentLimit
            ),

          limit:
            currentLimit,
        },
      });
    } catch (error) {
      console.error(
        "Admin get all posts error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to fetch admin posts."
      );
    }
  }
);

// GET /api/posts/admin/:id

router.get(
  "/admin/:id",
  protect,
  adminOnly,

  async (req, res) => {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid post ID.",
          });
      }

      const post =
        await Post.findById(
          req.params.id
        )
          .populate(
            "author",
            "name avatar bio"
          )
          .populate(
            "category",
            "name slug color"
          );

      if (!post) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Post not found.",
          });
      }

      return res.json({
        success: true,

        data:
          serializePost(
            post
          ),
      });
    } catch (error) {
      console.error(
        "Admin get post error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to fetch post."
      );
    }
  }
);

// GET /api/posts/:slug

router.get(
  "/:slug",
  async (req, res) => {
    try {
      const routeStart =
        Date.now();

      const slug =
        String(
          req.params.slug ||
            ""
        )
          .trim()
          .toLowerCase();

      if (!slug) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Blog slug is required.",
          });
      }

      // Main article

      const postQueryStart =
        Date.now();

      const post =
        await Post.findOne({
          slug,
          status:
            "published",
        })
          .populate(
            "author",
            "name avatar bio"
          )
          .populate(
            "category",
            "name slug color"
          );

      console.log(
        "BLOG TIMING - main post:",
        Date.now() -
          postQueryStart,
        "ms"
      );

      if (!post) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Post not found.",
          });
      }

      // Related articles

      const relatedQueryStart =
        Date.now();

      const related =
        await Post.find({
          status:
            "published",

          category:
            post.category?._id ||
            post.category,

          _id: {
            $ne: post._id,
          },
        })
          .populate(
            "author",
            "name avatar"
          )
          .populate(
            "category",
            "name slug color"
          )
          .select(
            "-content -tableOfContents"
          )
          .sort({
            publishedAt: -1,
          })
          .limit(3)
          .lean();

      console.log(
        "BLOG TIMING - related:",
        Date.now() -
          relatedQueryStart,
        "ms"
      );

      console.log(
        "BLOG TIMING - total:",
        Date.now() -
          routeStart,
        "ms"
      );

      /*
       * Browser ko pehle article response dene mein
       * view update ka wait nahi karwana.
       */
      Post.updateOne(
        {
          _id: post._id,
        },
        {
          $inc: {
            views: 1,
          },
        }
      ).catch((error) => {
        console.error(
          "Increment views error:",
          error
        );
      });

      const serializedPost =
        serializePost(post);

      /*
       * Current request ko updated-looking count
       * show karna ho to response mein +1.
       */
      if (
        typeof serializedPost.views ===
        "number"
      ) {
        serializedPost.views +=
          1;
      }

      return res.json({
        success: true,

        data:
          serializedPost,

        related:
          related.map(
            (item) =>
              serializePost(
                item,
                {
                  normalizeContent:
                    false,
                }
              )
          ),
      });
    } catch (error) {
      console.error(
        "Get single post error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to fetch post."
      );
    }
  }
);

// POST /api/posts

router.post(
  "/",
  protect,
  adminOnly,
  postValidation,

  async (req, res) => {
    try {
      if (
        sendValidationErrors(
          req,
          res
        )
      ) {
        return;
      }

      // Category check

      const category =
        await Category.findById(
          req.body.category
        ).select("_id");

      if (!category) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Selected category not found.",
          });
      }

      // Create document manually.
      // save() Post model hooks ko run karega.

      const post =
        new Post({
          author:
            req.user._id,
        });

      applyPostInput(
        post,
        req.body
      );

      await post.save();

      // Category count

      if (
        post.status ===
        "published"
      ) {
        await incrementCategoryCount(
          post.category
        );
      }

      const populatedPost =
        await Post.findById(
          post._id
        )
          .populate(
            "author",
            "name avatar bio"
          )
          .populate(
            "category",
            "name slug color"
          );

      return res
        .status(201)
        .json({
          success: true,

          data:
            serializePost(
              populatedPost
            ),
        });
    } catch (error) {
      console.error(
        "Create post error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to create post."
      );
    }
  }
);

// PUT /api/posts/:id

router.put(
  "/:id",
  protect,
  adminOnly,
  postValidation,

  async (req, res) => {
    try {
      if (
        sendValidationErrors(
          req,
          res
        )
      ) {
        return;
      }

      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid post ID.",
          });
      }

      const existingPost =
        await Post.findById(
          req.params.id
        );

      if (!existingPost) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Post not found.",
          });
      }

      // Old data

      const oldCategoryId =
        existingPost.category
          ? String(
              existingPost.category
            )
          : "";

      const wasPublished =
        existingPost.status ===
        "published";

      const oldDriveFileIds =
        getPostDriveFileIds(
          existingPost
        );

      // New category validation

      const requestedCategoryId =
        String(
          req.body.category ||
            oldCategoryId
        );

      if (
        !mongoose.Types.ObjectId.isValid(
          requestedCategoryId
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid category ID.",
          });
      }

      const categoryExists =
        await Category.exists({
          _id:
            requestedCategoryId,
        });

      if (
        !categoryExists
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Selected category not found.",
          });
      }

      /*
       * IMPORTANT:
       *
       * findByIdAndUpdate() use nahi kar rahe.
       *
       * existingPost.save() use karne se Post.js ke:
       *
       * - slug normalization
       * - readTime calculation
       * - publishedAt
       * - scheduledAt
       *
       * hooks properly run honge.
       */

      applyPostInput(
        existingPost,
        req.body
      );

      await existingPost.save();

      const newCategoryId =
        existingPost.category
          ? String(
              existingPost.category
            )
          : "";

      const isPublished =
        existingPost.status ===
        "published";

      // Category counts

      await syncCategoryPostCounts(
        {
          oldCategoryId,
          newCategoryId,
          wasPublished,
          isPublished,
        }
      );

      // Removed Drive images

      const newDriveFileIds =
        getPostDriveFileIds(
          existingPost
        );

      const currentIds =
        new Set(
          newDriveFileIds
        );

      const removedDriveFileIds =
        oldDriveFileIds.filter(
          (fileId) =>
            !currentIds.has(
              fileId
            )
        );

      let imageCleanup = {
        deleted: [],
        skipped: [],
        failed: [],
      };

      if (
        removedDriveFileIds.length >
        0
      ) {
        imageCleanup =
          await cleanupDriveFiles(
            removedDriveFileIds,
            existingPost._id
          );
      }

      const populatedPost =
        await Post.findById(
          existingPost._id
        )
          .populate(
            "author",
            "name avatar bio"
          )
          .populate(
            "category",
            "name slug color"
          );

      return res.json({
        success: true,

        data:
          serializePost(
            populatedPost
          ),

        imageCleanup,
      });
    } catch (error) {
      console.error(
        "Update post error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to update post."
      );
    }
  }
);

// DELETE /api/posts/:id

router.delete(
  "/:id",
  protect,
  adminOnly,

  async (req, res) => {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid post ID.",
          });
      }

      // Find post

      const post =
        await Post.findById(
          req.params.id
        );

      if (!post) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Post not found.",
          });
      }

      const wasPublished =
        post.status ===
        "published";

      const categoryId =
        post.category
          ? String(
              post.category
            )
          : "";

      /*
       * Cover + content dono ke Drive IDs collect karo.
       */
      const driveFileIds =
        getPostDriveFileIds(
          post
        );

      // Delete MongoDB post first

      await Post.findByIdAndDelete(
        post._id
      );

      // Category count

      if (
        wasPublished &&
        categoryId
      ) {
        try {
          await decrementCategoryCount(
            categoryId
          );
        } catch (error) {
          console.error(
            "⚠️ Category count cleanup failed:",
            error.message
          );
        }
      }

      /*
       * Drive cleanup best-effort hai.
       *
       * Google Drive temporarily unavailable ho to
       * article deletion block nahi hogi.
       */
      const imageCleanup =
        await cleanupDriveFiles(
          driveFileIds,
          post._id
        );

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Post deleted successfully.",

          imageCleanup,
        });
    } catch (error) {
      console.error(
        "Delete post error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to delete post."
      );
    }
  }
);

// PATCH /api/posts/:id/toggle-featured

router.patch(
  "/:id/toggle-featured",
  protect,
  adminOnly,

  async (req, res) => {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid post ID.",
          });
      }

      const post =
        await Post.findById(
          req.params.id
        );

      if (!post) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Post not found.",
          });
      }

      post.featured =
        !post.featured;

      /*
       * Normal save use karo.
       * Post model valid state mein rahega.
       */
      await post.save();

      const populatedPost =
        await Post.findById(
          post._id
        )
          .populate(
            "author",
            "name avatar"
          )
          .populate(
            "category",
            "name slug color"
          );

      return res.json({
        success: true,

        data:
          serializePost(
            populatedPost
          ),
      });
    } catch (error) {
      console.error(
        "Toggle featured error:",
        error
      );

      return sendPostError(
        res,
        error,
        "Failed to update featured status."
      );
    }
  }
);

// EXPORT

export default router;