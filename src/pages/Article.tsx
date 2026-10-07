import { useParams } from "react-router-dom";
import ContentPage, { TextLink } from "@/components/ContentPage";
import { ARTICLES, findArticle, formatArticleDate } from "@/content/articles";
import NotFound from "./NotFound";

/** /blog/:slug — one article, looked up from src/content/articles.tsx. */
const Article = () => {
  const { slug } = useParams();
  const article = findArticle(slug);
  if (!article) return <NotFound />;

  const others = ARTICLES.filter((a) => a.slug !== article.slug);

  return (
    <ContentPage
      // Keyed by slug so moving between articles remounts the page and its
      // metadata effect, rather than reusing the previous article's tags.
      key={article.slug}
      eyebrow={article.tag}
      heading={article.title}
      lede={article.excerpt}
      byline={
        <>
          <time dateTime={article.date}>{formatArticleDate(article.date)}</time> ·{" "}
          {article.readMinutes} min read
        </>
      }
      meta={{
        title: article.metaTitle,
        description: article.metaDescription,
        path: `/blog/${article.slug}`,
      }}
    >
      <article>{article.body}</article>

      {others.length > 0 && (
        <nav aria-label="More articles" className="mt-14 pt-8 border-t border-border">
          <p className="font-display font-bold text-foreground mb-3">Keep reading</p>
          <ul className="space-y-2">
            {others.map((a) => (
              <li key={a.slug}>
                <TextLink to={`/blog/${a.slug}`}>{a.title}</TextLink>
              </li>
            ))}
            <li>
              <TextLink to="/blog">All articles</TextLink>
            </li>
          </ul>
        </nav>
      )}
    </ContentPage>
  );
};

export default Article;
