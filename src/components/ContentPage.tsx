import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import TopBar from "@/components/TopBar";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CONTACT } from "@/lib/contact";
import { usePageMeta } from "@/lib/usePageMeta";

/**
 * Shared shell for the explainer, FAQ, "why us" and article pages.
 *
 * Same header treatment as /how-it-works so the site reads as one product, a
 * single readable column (~65 characters a line) for the body, and the same
 * closing call to action on every page — a reader who finishes an article is
 * the warmest lead on the site, and the page should not end in a dead stop.
 */

interface ContentPageProps {
  /** Small label above the headline. */
  eyebrow: string;
  /** The visible <h1>. */
  heading: string;
  /** One or two sentences under the headline. */
  lede: ReactNode;
  /** Optional line under the lede (dates, read time). */
  byline?: ReactNode;
  /** Search metadata for this route — see usePageMeta. */
  meta: { title: string; description: string; path: string };
  children: ReactNode;
}

const ContentPage = ({ eyebrow, heading, lede, byline, meta, children }: ContentPageProps) => {
  usePageMeta(meta);

  return (
    <div className="min-h-screen">
      <TopBar />
      <Navbar />

      <main>
        <section className="bg-hero">
          <div className="container-wide px-4 sm:px-6 lg:px-8 pt-12 pb-14 md:pt-16 md:pb-20">
            <div className="max-w-3xl mx-auto">
              <p className="inline-block bg-accent/15 border border-accent/40 text-accent rounded-full px-4 py-1.5 mb-5 text-xs font-semibold uppercase tracking-widest">
                {eyebrow}
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-primary-foreground leading-[1.1] tracking-tight mb-5 text-balance">
                {heading}
              </h1>
              <p className="text-primary-foreground/90 text-base md:text-lg leading-relaxed">{lede}</p>
              {byline && <p className="text-primary-foreground/60 text-sm mt-5">{byline}</p>}
            </div>
          </div>
        </section>

        <section className="section-padding bg-background">
          <div className="container-wide px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">{children}</div>
          </div>
        </section>

        <section className="bg-dark-section">
          <div className="container-wide px-4 sm:px-6 lg:px-8 py-14 md:py-16 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-3 text-balance">
              You did the work. Let&rsquo;s get you paid.
            </h2>
            <p className="opacity-90 mb-7 max-w-xl mx-auto">
              Start with a short application, or just call us at {CONTACT.phone} and
              talk it through. No pressure, no obligation.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 justify-center">
              <Link
                to="/#get-started"
                className="btn-accent text-base px-7 py-3.5 group focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                           focus-visible:ring-offset-primary"
              >
                Apply Now
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
              <a
                href={`tel:${CONTACT.phoneTel}`}
                className="btn-outline-light text-base px-7 py-3.5 focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                           focus-visible:ring-offset-primary"
              >
                Call {CONTACT.phone}
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default ContentPage;

// ─── Prose primitives ─────────────────────────────────────────────────────────
// No typography plugin is installed, so body copy is built from these. Keeping
// the styles here means every article and page reads the same way.

export const H2 = ({ children, id }: { children: ReactNode; id?: string }) => (
  <h2 id={id} className="text-2xl md:text-3xl font-display font-bold text-foreground mt-12 first:mt-0 mb-4 text-balance scroll-mt-24">
    {children}
  </h2>
);

export const P = ({ children }: { children: ReactNode }) => (
  <p className="text-foreground/85 text-base md:text-lg leading-relaxed mb-5">{children}</p>
);

export const List = ({ items, ordered = false }: { items: ReactNode[]; ordered?: boolean }) => {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={`${ordered ? "list-decimal" : "list-disc"} pl-6 mb-6 space-y-2.5 marker:text-accent
                  text-foreground/85 text-base md:text-lg leading-relaxed`}
    >
      {items.map((item, i) => <li key={i} className="pl-1">{item}</li>)}
    </Tag>
  );
};

/** A highlighted aside — a worked example, a tip, or a "what to ask" box. */
export const Callout = ({ title, children }: { title?: string; children: ReactNode }) => (
  <aside className="rounded-xl border border-accent/30 bg-accent/5 p-5 md:p-6 my-8">
    {title && (
      <p className="font-display font-bold text-foreground mb-2 text-sm uppercase tracking-wide">{title}</p>
    )}
    <div className="text-foreground/85 leading-relaxed [&>p:last-child]:mb-0 [&>p]:mb-3">{children}</div>
  </aside>
);

/** Internal link styled for running text. */
export const TextLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-accent font-semibold underline underline-offset-2 decoration-accent/40 hover:decoration-accent">
    {children}
  </Link>
);
