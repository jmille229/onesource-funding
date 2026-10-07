import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { type Article, formatArticleDate } from "@/content/articles";

/**
 * One article teaser. Used by the homepage "Recent News & Trends" strip and the
 * /blog index, so the two can never drift apart.
 *
 * The whole card is one link, labelled with the article title, so a screen
 * reader announces "What Is Micro Funding?" rather than three "Read More"s.
 */
const ArticleCard = ({ article }: { article: Article }) => (
  <Link
    to={`/blog/${article.slug}`}
    aria-label={article.title}
    className="flex flex-col h-full bg-card rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all
               duration-300 hover:-translate-y-1 group focus-visible:outline-none focus-visible:ring-2
               focus-visible:ring-accent focus-visible:ring-offset-2"
  >
    <div className="h-40 bg-hero flex items-center justify-center" aria-hidden="true">
      <div className="w-16 h-16 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center">
        <article.icon className="h-8 w-8 text-accent" />
      </div>
    </div>
    <div className="p-6 flex flex-col flex-1">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs font-semibold text-accent bg-accent/10 px-3 py-1 rounded-full">
          {article.tag}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatArticleDate(article.date)} · {article.readMinutes} min read
        </span>
      </div>
      <h3 className="text-lg font-display font-bold text-foreground mb-2 group-hover:text-accent transition-colors">
        {article.title}
      </h3>
      <p className="text-muted-foreground text-sm leading-relaxed mb-4 flex-1">{article.excerpt}</p>
      <span className="text-accent font-semibold text-sm flex items-center gap-1 group-hover:gap-2 transition-all" aria-hidden="true">
        Read More <ArrowRight className="h-4 w-4" />
      </span>
    </div>
  </Link>
);

export default ArticleCard;
