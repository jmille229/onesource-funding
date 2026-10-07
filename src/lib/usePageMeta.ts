import { useEffect } from "react";

/** Canonical origin for the marketing site. Matches og:url in index.html. */
export const SITE_URL = "https://os-funding.com";

interface PageMeta {
  /** Full document title, shown in the browser tab and as the search-result headline. */
  title: string;
  /** Meta description, shown under the headline in search results. */
  description: string;
  /** Route path, e.g. "/faq". Used for the canonical URL and og:url. */
  path: string;
}

/**
 * Per-route search metadata for a single-page app.
 *
 * Every route on this site is served the same index.html, so without this every
 * page would carry the homepage's title and description — and Google would see
 * the FAQ, each article and the explainer page as near-duplicates of the home
 * page. Google renders JavaScript before indexing, so setting these on mount is
 * enough for it to pick up each page's own metadata.
 *
 * This is also where search-only wording lives. A page can be titled in search
 * results with terms ("invoice factoring") that its visible heading deliberately
 * avoids — the <title> and description are what a search engine ranks on, the
 * <h1> is what a visitor reads.
 *
 * The homepage's own search wording is static in index.html: its <title> and
 * description say "invoice factoring" (the term business owners search for),
 * while og:/twitter: tags — what a shared link previews as — keep the softer
 * "specialty finance" positioning. Explained here rather than in an HTML
 * comment there, since HTML comments ship to every visitor's page source.
 *
 * Restores the previous values on unmount, so navigating back to a page that
 * doesn't call this hook (the homepage) gets the static tags from index.html.
 */
export function usePageMeta({ title, description, path }: PageMeta): void {
  useEffect(() => {
    const url = `${SITE_URL}${path}`;
    const undo: Array<() => void> = [];

    const prevTitle = document.title;
    document.title = title;
    undo.push(() => { document.title = prevTitle; });

    const setAttr = (selector: string, create: () => HTMLElement, attr: string, value: string) => {
      let el = document.head.querySelector<HTMLElement>(selector);
      let created = false;
      if (!el) {
        el = create();
        document.head.appendChild(el);
        created = true;
      }
      const prev = el.getAttribute(attr);
      el.setAttribute(attr, value);
      const node = el;
      undo.push(() => {
        if (created) node.remove();
        else if (prev !== null) node.setAttribute(attr, prev);
      });
    };

    const meta = (key: "name" | "property", name: string) => () => {
      const m = document.createElement("meta");
      m.setAttribute(key, name);
      return m;
    };

    setAttr('meta[name="description"]', meta("name", "description"), "content", description);
    setAttr('meta[property="og:title"]', meta("property", "og:title"), "content", title);
    setAttr('meta[property="og:description"]', meta("property", "og:description"), "content", description);
    setAttr('meta[property="og:url"]', meta("property", "og:url"), "content", url);
    setAttr('meta[name="twitter:title"]', meta("name", "twitter:title"), "content", title);
    setAttr('meta[name="twitter:description"]', meta("name", "twitter:description"), "content", description);
    setAttr(
      'link[rel="canonical"]',
      () => {
        const l = document.createElement("link");
        l.setAttribute("rel", "canonical");
        return l;
      },
      "href",
      url,
    );

    // Undo in reverse so nested changes unwind cleanly.
    return () => { for (let i = undo.length - 1; i >= 0; i--) undo[i]!(); };
  }, [title, description, path]);
}
