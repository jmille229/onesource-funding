import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const posts = [
  {
    tag: "Cash Flow",
    title: "What Is Micro Factoring?",
    excerpt: "Do you need working capital now? Running a small business or startup typically means navigating unique financial challenges...",
    date: "Feb 16, 2026",
  },
  {
    tag: "Business Growth",
    title: "Line of Credit vs. Invoice Factoring",
    excerpt: "Which funding option is right for you? For any small business owner, understanding the difference between these two options is key...",
    date: "Feb 5, 2026",
  },
  {
    tag: "Business Finance",
    title: "Understanding UCC Filings",
    excerpt: "If you're exploring funding options for your business, understanding UCC filings is essential to making the right choice...",
    date: "Feb 3, 2026",
  },
];

const BlogSection = () => (
  <section className="section-padding bg-secondary/50">
    <div className="container-wide">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground">
          Recent News & Trends
        </h2>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {posts.map((post, i) => (
          <motion.a
            key={post.title}
            href="#"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.12 }}
            className="bg-card rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 group"
          >
            <div className="h-48 bg-primary/10 flex items-center justify-center">
              <span className="text-primary/30 text-6xl font-display font-bold">{i + 1}</span>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-semibold text-accent bg-accent/10 px-3 py-1 rounded-full">
                  {post.tag}
                </span>
                <span className="text-xs text-muted-foreground">{post.date}</span>
              </div>
              <h3 className="text-lg font-display font-bold text-foreground mb-2 group-hover:text-accent transition-colors">
                {post.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">{post.excerpt}</p>
              <span className="text-accent font-semibold text-sm flex items-center gap-1 group-hover:gap-2 transition-all">
                Read More <ArrowRight className="h-4 w-4" />
              </span>
            </div>
          </motion.a>
        ))}
      </div>
    </div>
  </section>
);

export default BlogSection;
