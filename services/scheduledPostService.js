import cron from "node-cron";

import Post from "../models/Post.js";
import Category from "../models/Category.js";

// STATE

let publisherStarted = false;
let publishJobRunning = false;
let reconciliationRunning = false;

let publishTask = null;
let reconciliationTask = null;

const MAX_POSTS_PER_RUN = 100;

// SYNC ONE CATEGORY COUNT

const syncCategoryPostCount = async (categoryId) => {
  if (!categoryId) {
    return;
  }

  try {
    const publishedCount = await Post.countDocuments({
      category: categoryId,
      status: "published",
    });

    await Category.findByIdAndUpdate(categoryId, {
      $set: {
        postCount: publishedCount,
      },
    });
  } catch (error) {
    console.error(
      `❌ Category count sync failed for ${categoryId}:`,
      error?.message || error
    );
  }
};

// RECONCILE ALL CATEGORY COUNTS

/*
 * postCount ek cached value hai.
 *
 * Agar:
 * - server crash ho
 * - old code ne duplicate increment kiya ho
 * - scheduled publish ke beech process stop ho
 *
 * to ye function MongoDB posts ko source of truth maan kar
 * category counts dobara exact set karta hai.
 */
export const reconcileCategoryPostCounts = async () => {
  if (reconciliationRunning) {
    return;
  }

  reconciliationRunning = true;

  try {
    const publishedCounts = await Post.aggregate([
      {
        $match: {
          status: "published",
        },
      },
      {
        $group: {
          _id: "$category",
          count: {
            $sum: 1,
          },
        },
      },
    ]);

    const countMap = new Map();

    publishedCounts.forEach((item) => {
      if (!item?._id) {
        return;
      }

      countMap.set(
        String(item._id),
        Number(item.count) || 0
      );
    });

    const categories = await Category.find({})
      .select("_id postCount")
      .lean();

    if (categories.length === 0) {
      return;
    }

    const operations = categories.map((category) => ({
      updateOne: {
        filter: {
          _id: category._id,
        },

        update: {
          $set: {
            postCount:
              countMap.get(String(category._id)) || 0,
          },
        },
      },
    }));

    if (operations.length > 0) {
      await Category.bulkWrite(operations, {
        ordered: false,
      });
    }

    console.log(
      `🔄 Category post counts reconciled: ${categories.length} category(s)`
    );
  } catch (error) {
    console.error(
      "❌ Category post count reconciliation error:",
      error?.message || error
    );
  } finally {
    reconciliationRunning = false;
  }
};

// PUBLISH SCHEDULED POSTS

export const publishScheduledPosts = async () => {
  /*
   * Same Node process mein overlapping cron runs prevent karta hai.
   */
  if (publishJobRunning) {
    console.log(
      "⏳ Scheduled post publisher already running. Skipping this cycle."
    );

    return {
      success: true,
      skipped: true,
      published: 0,
    };
  }

  publishJobRunning = true;

  try {
    const now = new Date();

    /*
     * Pehle sirf IDs aur required fields load karte hain.
     * Full content load karne ki zarurat nahi.
     */
    const duePosts = await Post.find({
      status: "scheduled",

      scheduledAt: {
        $ne: null,
        $lte: now,
      },
    })
      .select("_id title category scheduledAt")
      .sort({
        scheduledAt: 1,
      })
      .limit(MAX_POSTS_PER_RUN)
      .lean();

    if (duePosts.length === 0) {
      return {
        success: true,
        published: 0,
      };
    }

    console.log(
      `⏰ Found ${duePosts.length} scheduled post(s) ready to publish`
    );

    const affectedCategoryIds = new Set();

    let publishedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const scheduledPost of duePosts) {
      try {
        /*
         * IMPORTANT:
         *
         * findOneAndUpdate filter mein:
         *
         * status: "scheduled"
         *
         * rakha gaya hai.
         *
         * Agar do backend instances same post ko same waqt
         * publish karne ki koshish karein, sirf ek instance
         * successfully update karega.
         */
        const publishedPost = await Post.findOneAndUpdate(
          {
            _id: scheduledPost._id,

            status: "scheduled",

            scheduledAt: {
              $ne: null,
              $lte: now,
            },
          },
          {
            $set: {
              status: "published",

              publishedAt: new Date(),

              scheduledAt: null,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        ).select(
          "_id title category status publishedAt"
        );

        /*
         * null means another process/server already handled it.
         */
        if (!publishedPost) {
          skippedCount += 1;

          console.log(
            `ℹ️ Scheduled post already handled: ${scheduledPost.title}`
          );

          continue;
        }

        publishedCount += 1;

        if (publishedPost.category) {
          affectedCategoryIds.add(
            String(publishedPost.category)
          );
        }

        console.log(
          `✅ Scheduled post published: ${publishedPost.title}`
        );
      } catch (postError) {
        failedCount += 1;

        console.error(
          `❌ Failed to publish scheduled post ${scheduledPost._id}:`,
          postError?.message || postError
        );
      }
    }

    /*
     * $inc use nahi kar rahe.
     *
     * Exact published post count calculate karke category
     * postCount set karte hain.
     *
     * Is se duplicate cron executions se count double nahi hoga.
     */
    for (const categoryId of affectedCategoryIds) {
      await syncCategoryPostCount(categoryId);
    }

    console.log(
      `⏰ Scheduled publisher finished — Published: ${publishedCount}, Skipped: ${skippedCount}, Failed: ${failedCount}`
    );

    return {
      success: true,

      published: publishedCount,

      skipped: skippedCount,

      failed: failedCount,
    };
  } catch (error) {
    console.error(
      "❌ Scheduled post publishing error:",
      error?.message || error
    );

    return {
      success: false,

      published: 0,

      message:
        error?.message ||
        "Scheduled post publishing failed.",
    };
  } finally {
    publishJobRunning = false;
  }
};

// START SCHEDULER

export const startScheduledPostPublisher = () => {
  /*
   * Same process mein scheduler do dafa register na ho.
   */
  if (publisherStarted) {
    console.log(
      "ℹ️ Scheduled post publisher already started"
    );

    return;
  }

  publisherStarted = true;

  // Publish check every minute
  publishTask = cron.schedule("* * * * *", async () => {
    await publishScheduledPosts();
  });

  /*
   * Every 10 minutes category counts self-repair.
   *
   * Ye old incorrect counts bhi automatically repair kar dega.
   */
  reconciliationTask = cron.schedule(
    "*/10 * * * *",
    async () => {
      await reconcileCategoryPostCounts();
    }
  );

  console.log(
    "⏰ Scheduled post publisher started"
  );

  /*
   * Backend start hote hi overdue scheduled posts publish karo.
   */
  publishScheduledPosts().catch((error) => {
    console.error(
      "❌ Initial scheduled publish check failed:",
      error?.message || error
    );
  });

  /*
   * Startup par category counts bhi repair kar do.
   */
  reconcileCategoryPostCounts().catch((error) => {
    console.error(
      "❌ Initial category reconciliation failed:",
      error?.message || error
    );
  });
};

// STOP SCHEDULER

export const stopScheduledPostPublisher = () => {
  try {
    if (publishTask) {
      publishTask.stop();
      publishTask = null;
    }

    if (reconciliationTask) {
      reconciliationTask.stop();
      reconciliationTask = null;
    }

    publisherStarted = false;

    console.log(
      "🛑 Scheduled post publisher stopped"
    );
  } catch (error) {
    console.error(
      "❌ Failed to stop scheduled post publisher:",
      error?.message || error
    );
  }
};

export default publishScheduledPosts;