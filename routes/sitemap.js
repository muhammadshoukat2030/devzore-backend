import express from "express";
import Post from "../models/Post.js";

const router = express.Router();

const SITE_URL = "https://devzore.com";

// ======================================================
// XML ESCAPE
// ======================================================

const escapeXml = (value = "") => {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

// ======================================================
// STATIC WEBSITE ROUTES
// These routes always remain in the sitemap.
// ======================================================

const mainPages = [
  "/",
  "/about",
  "/contact",
  "/blog",
  "/allservices",
];

const servicePages = [
  "/web-development",
  "/mobile-apps",
  "/ecommerce",
  "/backend-api",
  "/mern-stack-development",
  "/saas-product-development",
  "/reactdevelopment",
  "/ui-ux-design",
  "/startup-mvp",
  "/maintenance",
  "/seo-services",
  "/digital-marketing",
];

const legalPages = [
  "/privacy-policy",
  "/terms-and-conditions",
];

// ======================================================
// GENERATE STATIC URL XML
// ======================================================

const generateStaticUrl = (
  path,
  changefreq = "monthly",
  priority = "0.8"
) => {
  const url =
    path === "/"
      ? `${SITE_URL}/`
      : `${SITE_URL}${path}`;

  return `  <url>
    <loc>${escapeXml(url)}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
};

// ======================================================
// GENERATE COMPLETE SITEMAP
//
// Static pages
// +
// Published blog posts from MongoDB
// +
// Legal pages
// ======================================================

const generateSitemap = async (req, res) => {
  try {
    // ==================================================
    // GET PUBLISHED BLOG POSTS
    // ==================================================

    const posts = await Post.find({
      status: "published",

      slug: {
        $exists: true,
        $ne: "",
      },
    })
      .select("slug updatedAt publishedAt")
      .sort({
        publishedAt: -1,
      })
      .lean();

    // ==================================================
    // MAIN PAGES
    // ==================================================

    const mainUrls = mainPages
      .map((path) => {
        // Homepage
        if (path === "/") {
          return generateStaticUrl(
            path,
            "weekly",
            "1.0"
          );
        }

        // Blog listing page
        if (path === "/blog") {
          return generateStaticUrl(
            path,
            "daily",
            "0.9"
          );
        }

        return generateStaticUrl(
          path,
          "monthly",
          "0.8"
        );
      })
      .join("\n");

    // ==================================================
    // SERVICE PAGES
    // ==================================================

    const serviceUrls = servicePages
      .map((path) =>
        generateStaticUrl(
          path,
          "monthly",
          "0.9"
        )
      )
      .join("\n");

    // ==================================================
    // DYNAMIC BLOG POSTS
    //
    // Every published MongoDB post automatically
    // appears here.
    // ==================================================

    const blogUrls = posts
      .map((post) => {
        const blogUrl =
          `${SITE_URL}/blog/${encodeURIComponent(
            post.slug
          )}`;

        const lastModified =
          post.updatedAt ||
          post.publishedAt;

        const lastmodXml = lastModified
          ? `\n    <lastmod>${new Date(
              lastModified
            ).toISOString()}</lastmod>`
          : "";

        return `  <url>
    <loc>${escapeXml(blogUrl)}</loc>${lastmodXml}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
      })
      .join("\n");

    // ==================================================
    // LEGAL PAGES
    // ==================================================

    const legalUrls = legalPages
      .map((path) =>
        generateStaticUrl(
          path,
          "yearly",
          "0.3"
        )
      )
      .join("\n");

    // ==================================================
    // FINAL XML
    // ==================================================

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

  <!-- =========================
       MAIN PAGES
  ========================== -->

${mainUrls}

  <!-- =========================
       SERVICES
  ========================== -->

${serviceUrls}

  <!-- =========================
       BLOG POSTS
       Automatically generated
       from published MongoDB posts
  ========================== -->

${blogUrls}

  <!-- =========================
       LEGAL
  ========================== -->

${legalUrls}

</urlset>`;

    // ==================================================
    // RESPONSE HEADERS
    // ==================================================

    res.set({
      "Content-Type":
        "application/xml; charset=utf-8",

      // Browser revalidates every request.
      // CDN may cache for maximum 5 minutes.
      "Cache-Control":
        "public, max-age=0, s-maxage=300, must-revalidate",
    });

    return res
      .status(200)
      .send(xml);

  } catch (error) {
    console.error(
      "❌ Sitemap generation failed:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to generate sitemap.",
    });
  }
};

// ======================================================
// ROUTES
// ======================================================

// Complete sitemap:
// http://localhost:5000/api/sitemap
router.get("/", generateSitemap);

// Same complete sitemap:
// http://localhost:5000/api/sitemap/sitemap.xml
router.get(
  "/sitemap.xml",
  generateSitemap
);

// Backward compatibility:
// http://localhost:5000/api/sitemap/blog.xml
router.get(
  "/blog.xml",
  generateSitemap
);

// ======================================================
// EXPORT
// ======================================================

export default router;