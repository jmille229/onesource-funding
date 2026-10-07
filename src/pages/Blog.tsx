import TopBar from "@/components/TopBar";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ArticleCard from "@/components/ArticleCard";
import { ARTICLES } from "@/content/articles";
import { usePageMeta } from "@/lib/usePageMeta";

/**
 * /blog — every article, newest first.
 *
 * Doesn't use ContentPage: that shell is a single reading column, and an index
 * of cards wants the full-width grid the homepage uses.
 */

const Blog = () => {
  usePageMeta({
    title: "Cash Flow & Funding Guides for Small Businesses | One Source Funding Blog",
    description:
      "Plain-English guides for contractors and small business owners on cash flow, invoice funding and factoring, lines of credit, UCC filings and getting paid faster.",
    path: "/blog",
  });

  const articles = [...ARTICLES].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="min-h-screen">
      <TopBar />
      <Navbar />

      <main>
        <section className="bg-hero px-4 sm:px-6 lg:px-8">
          <div className="container-wide pt-12 pb-14 md:pt-16 md:pb-20">
            {/* Left-aligned with the card grid below, unlike the centered
                reading column on article pages. */}
            <div className="max-w-3xl">
              <p className="inline-block bg-accent/15 border border-accent/40 text-accent rounded-full px-4 py-1.5 mb-5 text-xs font-semibold uppercase tracking-widest">
                News &amp; guides
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-primary-foreground leading-[1.1] tracking-tight mb-5 text-balance">
                Straight talk about cash flow
              </h1>
              <p className="text-primary-foreground/90 text-base md:text-lg leading-relaxed">
                Practical, plain-English guides for business owners who are tired of
                waiting to get paid. No jargon, no sales pitch.
              </p>
            </div>
          </div>
        </section>

        <section className="section-padding bg-secondary/50">
          <div className="container-wide">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {articles.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Blog;
