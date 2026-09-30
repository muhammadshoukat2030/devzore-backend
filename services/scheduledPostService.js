import cron from "node-cron";
import Post from "../models/Post.js";
import Category from "../models/Category.js";

const publishScheduledPosts = async () => {
  try {
    const now = new Date();

    const posts = await Post.find({
      status: "scheduled",
      scheduledAt: {
        $ne: null,
        $lte: now,
      },
    });

    if (posts.length === 0) {
      return;
    }

    console.log(
      `⏰ Found ${posts.length} scheduled post(s) ready to publish`
    );

    for (const post of posts) {
      post.status = "published";
      post.publishedAt = new Date();
      post.scheduledAt = null;

      await post.save();

      if (post.category) {
        await Category.findByIdAndUpdate(
          post.category,
          {
            $inc: {
              postCount: 1,
            },
          }
        );
      }

      console.log(
        `✅ Scheduled post published: ${post.title}`
      );
    }
  } catch (error) {
    console.error(
      "❌ Scheduled post publishing error:",
      error
    );
  }
};

export const startScheduledPostPublisher = () => {
  // Check every minute
  cron.schedule("* * * * *", async () => {
    await publishScheduledPosts();
  });

  console.log(
    "⏰ Scheduled post publisher started"
  );

  // Check immediately when backend starts
  publishScheduledPosts();
};

export default publishScheduledPosts;