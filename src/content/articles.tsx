import type { ComponentType, ReactNode } from "react";
import { FileText, TrendingUp, Wallet } from "lucide-react";
import { Callout, H2, List, P, TextLink } from "@/components/ContentPage";

/**
 * Articles shown on the homepage ("Recent News & Trends"), the /blog index and
 * each /blog/:slug page.
 *
 * Writing rules these follow, so new ones read the same:
 *   - Talk to one contractor, in plain English. Short paragraphs, real
 *     situations (payroll on Friday, the agency paying in 75 days).
 *   - Be useful even to someone who never becomes a client. An honest article
 *     ("a bank line of credit may be cheaper if you qualify") earns more trust
 *     than a pitch, and trust is what this audience is short on with funders.
 *   - Only claim what the business actually does. No invented rates, terms,
 *     statistics or testimonials.
 *   - "Factoring" is fine in body copy and in metaTitle/metaDescription (for
 *     search), but not in the visible headline.
 */

export interface Article {
  slug: string;
  tag: string;
  /** Shown on the article card in place of a photo. */
  icon: ComponentType<{ className?: string }>;
  /** Visible headline — on the card and the article's <h1>. */
  title: string;
  /** Card text and the article's lede. */
  excerpt: string;
  /** Search-result headline (document.title). */
  metaTitle: string;
  /** Search-result description. */
  metaDescription: string;
  /** Publish date, ISO yyyy-mm-dd. */
  date: string;
  readMinutes: number;
  body: ReactNode;
}

/**
 * "2026-10-07" → "Oct 7, 2026".
 *
 * Parsed by hand rather than `new Date("2026-10-07")`, which is read as UTC
 * midnight and therefore displays as Oct 6 for every visitor in the Americas.
 */
export function formatArticleDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Rows for the comparison in "Line of Credit vs. Invoice Funding". */
const LOC_VS_FUNDING: Array<[label: string, lineOfCredit: string, invoiceFunding: string]> = [
  ["Based on", "Your credit, financials and collateral", "Your invoices and the customer who owes them"],
  ["Getting set up", "Often weeks of paperwork", "A short application and a few documents"],
  ["Is it debt?", "Yes — you borrow and repay", "Generally no — you're paid early for work you've done"],
  ["How much", "A fixed limit set by the bank", "Grows as your invoices grow"],
  ["Cost", "Interest — often lower, if you qualify", "A fee based on how long your customer takes to pay"],
  ["Best for", "Established businesses with strong financials", "Growing businesses waiting on slow-paying customers"],
];

export const ARTICLES: Article[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: "what-is-micro-funding",
    tag: "Cash Flow",
    icon: Wallet,
    title: "What Is Micro Funding?",
    excerpt:
      "Small invoices can squeeze your cash flow just as hard as big ones. Here's how getting paid early on them works — and the questions to ask before you sign with anyone.",
    metaTitle: "What Is Micro Funding? Small-Invoice Factoring for Contractors | One Source Funding",
    metaDescription:
      "Micro funding — sometimes called micro-factoring — means getting paid early on smaller invoices. What it is, why small invoices hurt cash flow, and what to ask a funder.",
    date: "2026-10-07",
    readMinutes: 4,
    body: (
      <>
        <P>
          When most people picture invoice funding, they picture big companies moving
          millions of dollars. But most of the contractors we talk to aren&rsquo;t sending
          million-dollar invoices. They&rsquo;re sending invoices for $5,000, $12,000,
          $20,000 — and waiting on every single one of them.
        </P>

        <H2>What &ldquo;micro funding&rdquo; means</H2>
        <P>
          Micro funding simply means getting paid early on smaller invoices — sometimes
          one at a time. In the industry you&rsquo;ll sometimes hear it called
          micro-factoring. The idea is exactly the same as funding a big invoice:
          you&rsquo;ve done the work, the agency owes you, and you&rsquo;d rather not
          wait 60 days to see the money.
        </P>

        <H2>Why small invoices hurt more than you&rsquo;d think</H2>
        <P>
          A $10,000 invoice might not sound like a crisis. But if you run a five-person
          crew, that can be a couple of weeks of payroll. And it&rsquo;s rarely just one
          invoice — it&rsquo;s three or four, all sitting in an agency&rsquo;s approval
          queue at the same time.
        </P>
        <P>That&rsquo;s when the squeeze shows up:</P>
        <List
          items={[
            "Payroll goes out every week, but the agency pays when it pays.",
            "Your supplier wants to be paid on delivery, not when the city gets around to you.",
            "You have to pass on the next job because your cash is tied up in the last one.",
            "The gap ends up on a personal credit card — at credit-card interest rates.",
          ]}
        />
        <P>
          None of that means your business is in trouble. It means you&rsquo;re doing
          work faster than your customers pay for it. That&rsquo;s a timing problem, and
          timing problems have fixes.
        </P>

        <H2>What to ask before you sign with any funder</H2>
        <P>
          Not every funding company wants small business. Some are built for large
          monthly volumes and make that clear only in the fine print. Before you sign
          anything — with us or anyone else — ask:
        </P>
        <Callout title="Questions worth asking">
          <List
            items={[
              "Is there a minimum invoice size, or a minimum amount I have to fund each month?",
              "Do I have to fund all of my invoices, or can I choose which ones?",
              "Is there a long-term contract, or a fee to cancel?",
              "If a customer never pays, who is responsible — you or the funder? (This is called recourse, and it's worth understanding before you sign.)",
              "How is the fee calculated — and are there any other charges, like application, wire or monthly fees?",
              "After the first invoice, how fast does the money actually arrive?",
            ]}
          />
        </Callout>
        <P>
          Straight answers to those questions matter more than any headline rate. A low
          rate with a monthly minimum you can&rsquo;t meet isn&rsquo;t a low rate.
        </P>

        <H2>How we approach smaller invoices</H2>
        <P>
          The contractors we work with send us invoices ranging from a few thousand
          dollars to much larger amounts, and they choose which invoices to fund — fund
          one when an agency is dragging its feet, skip it when cash is fine. If you want
          to know how we&rsquo;d answer the questions above for your business, call us
          and ask. We&rsquo;ll give you straight answers.
        </P>
        <P>
          New to all of this? Start with{" "}
          <TextLink to="/invoice-funding">what invoice funding is</TextLink>, or see{" "}
          <TextLink to="/how-it-works">how it works</TextLink> step by step.
        </P>
      </>
    ),
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: "line-of-credit-vs-invoice-funding",
    tag: "Business Growth",
    icon: TrendingUp,
    title: "Line of Credit vs. Invoice Funding",
    excerpt:
      "Both can keep cash moving. They work very differently — and the right one depends on your business, not on which one a salesperson is pushing.",
    metaTitle: "Line of Credit vs. Invoice Factoring: Which Is Right for Your Business? | One Source Funding",
    metaDescription:
      "Comparing a business line of credit with invoice funding (invoice factoring): how each works, what each costs, how fast you can get it, and when each one makes sense.",
    date: "2026-10-07",
    readMinutes: 5,
    body: (
      <>
        <P>
          If you&rsquo;ve ever stared at a pile of unpaid invoices and a payroll due
          Friday, you&rsquo;ve probably looked at both options: a business line of credit
          from a bank, or invoice funding. They both put cash in your account. Under the
          hood, they&rsquo;re very different.
        </P>

        <H2>How a line of credit works</H2>
        <P>
          A business line of credit is a pool of money a bank or lender lets you borrow
          from as you need it. You pay interest on what you use, pay it back, and borrow
          again. It&rsquo;s flexible — and if you qualify, it&rsquo;s often one of the
          cheaper ways to borrow.
        </P>
        <P>
          The catch is qualifying. Banks usually want a couple of years in business,
          solid tax returns, good credit, and sometimes collateral. Approval can take
          weeks. And your limit is set by your financial statements — not by how much
          work you actually have.
        </P>

        <H2>How invoice funding works</H2>
        <P>
          Invoice funding — also called invoice factoring — is based on invoices
          you&rsquo;ve already earned. Instead of borrowing against your credit, you get
          paid early for work that&rsquo;s already done. You send the invoice, receive
          most of it upfront, and get the rest (minus a fee) when your customer pays.
        </P>
        <P>
          The big question isn&rsquo;t your credit score — it&rsquo;s whether the
          customer who owes you is good for it. When that customer is a government
          agency, it almost always is. The question is when, not if.
        </P>
        <P>
          And because it&rsquo;s tied to your invoices, it grows with your business. Win
          a bigger contract, and there&rsquo;s more you can fund.
        </P>

        <H2>Side by side</H2>
        {/* A real table from sm up; stacked rows on phones, where a
            three-column table would push one option off-screen. */}
        <div className="hidden sm:block my-6 rounded-xl border border-border overflow-hidden">
          <table className="w-full text-left text-sm md:text-base">
            <thead className="bg-secondary/60">
              <tr>
                <th scope="col" className="p-3 md:p-4 font-display font-bold text-foreground w-[24%]"><span className="sr-only">Compare</span></th>
                <th scope="col" className="p-3 md:p-4 font-display font-bold text-foreground">Line of credit</th>
                <th scope="col" className="p-3 md:p-4 font-display font-bold text-foreground">Invoice funding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-foreground/85">
              {LOC_VS_FUNDING.map(([label, loc, inv]) => (
                <tr key={label}>
                  <th scope="row" className="p-3 md:p-4 font-semibold text-foreground align-top">{label}</th>
                  <td className="p-3 md:p-4 align-top">{loc}</td>
                  <td className="p-3 md:p-4 align-top">{inv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="sm:hidden my-6 rounded-xl border border-border divide-y divide-border">
          {LOC_VS_FUNDING.map(([label, loc, inv]) => (
            <div key={label} className="p-4">
              <dt className="font-display font-bold text-foreground mb-2">{label}</dt>
              <dd className="text-foreground/85 text-sm mb-1.5">
                <span className="font-semibold text-foreground">Line of credit:</span> {loc}
              </dd>
              <dd className="text-foreground/85 text-sm">
                <span className="font-semibold text-foreground">Invoice funding:</span> {inv}
              </dd>
            </div>
          ))}
        </dl>

        <H2>So which one is right for you?</H2>
        <P>
          Honestly? If you qualify for a bank line of credit at a good rate and it covers
          what you need, it&rsquo;s worth having. Plenty of businesses use both — a line
          of credit for everyday needs, and invoice funding when a big job or a slow
          agency ties up cash.
        </P>
        <P>Invoice funding tends to make more sense when:</P>
        <List
          items={[
            <>You&rsquo;re newer or growing fast, and the bank keeps saying &ldquo;come back in two years.&rdquo;</>,
            "Your problem is slow payment, not a lack of work.",
            "You'd rather not take on more debt to cover money you're already owed.",
            "You need cash in days, not weeks.",
          ]}
        />

        <Callout title="One thing to check first">
          <p>
            If you already have a line of credit or a business loan, your bank may have a
            lien on your receivables. That doesn&rsquo;t rule out invoice funding — but it
            means the two need to be coordinated. Our guide to{" "}
            <TextLink to="/blog/understanding-ucc-filings">UCC filings</TextLink> explains
            what to look for.
          </p>
        </Callout>

        <P>
          Still weighing it up? The <TextLink to="/faq">FAQ</TextLink> covers costs,
          timing and what we need from you — or call us and we&rsquo;ll tell you
          honestly whether funding makes sense for your situation.
        </P>
      </>
    ),
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: "understanding-ucc-filings",
    tag: "Business Finance",
    icon: FileText,
    title: "Understanding UCC Filings",
    excerpt:
      "If you've ever borrowed money or used a funding company, there's a good chance there's a UCC filing with your business's name on it. Here's what that means, in plain English.",
    metaTitle: "Understanding UCC Filings: A Plain-English Guide for Small Businesses | One Source Funding",
    metaDescription:
      "What a UCC-1 filing is, why lenders and factoring companies file them, what a blanket lien means, and how to check and clear old filings on your business.",
    date: "2026-10-07",
    readMinutes: 5,
    body: (
      <>
        <P>
          You applied for funding, and somewhere in the paperwork someone mentioned a
          &ldquo;UCC filing.&rdquo; It sounds ominous. It isn&rsquo;t. It&rsquo;s one of
          the most routine pieces of business finance there is — but it&rsquo;s worth
          understanding, because it can affect what funding you can get later.
        </P>

        <H2>What is a UCC filing?</H2>
        <P>
          UCC stands for the Uniform Commercial Code, a set of rules for business
          transactions that every state has adopted. A <strong>UCC-1 financing
          statement</strong> is a short public notice, filed with your state, saying
          that a lender or funder has an interest in certain assets of your business. In
          Pennsylvania, filings are made with the Department of State.
        </P>
        <P>
          Think of it as a public bookmark. It doesn&rsquo;t take anything from you. It
          simply tells anyone who looks, &ldquo;This company has an agreement with us
          involving these assets.&rdquo;
        </P>

        <H2>Why lenders and funders file them</H2>
        <P>
          When a bank, lender or factoring company advances you money, it files a UCC-1
          to protect its place in line. If there&rsquo;s ever a question about who has
          rights to an asset, the filing date matters — generally, the first to file is
          first in line.
        </P>
        <P>
          That&rsquo;s why you&rsquo;ll see a filing from almost any lender or funder you
          work with, including us. It&rsquo;s standard practice, not a sign that anything
          is wrong.
        </P>

        <H2>What a filing covers</H2>
        <P>
          Every UCC-1 lists the &ldquo;collateral&rdquo; it covers, and that&rsquo;s the
          part to pay attention to. Some filings are narrow — for example, only your
          accounts receivable. Others are broad <strong>blanket liens</strong> covering
          nearly everything your business owns: equipment, inventory, receivables, bank
          accounts.
        </P>
        <P>
          Banks and many online lenders file blanket liens. That&rsquo;s not unusual, but
          it&rsquo;s worth knowing which kind you&rsquo;ve agreed to — because it shapes
          what you can do next.
        </P>

        <H2>Why it matters when you want funding</H2>
        <P>
          If a lender already has a blanket lien that includes your receivables, a new
          funder usually can&rsquo;t simply step in and fund your invoices. The first
          lender typically has to agree, often through a short agreement that spells out
          who has rights to what (you&rsquo;ll hear it called a subordination or
          intercreditor agreement).
        </P>
        <P>
          This comes up a lot, and it&rsquo;s usually solvable. But it takes time, so the
          best thing you can do is mention any existing loans or liens right at the
          start. Surprises late in the process are what slow funding down.
        </P>

        <H2>How to check your own filings</H2>
        <P>
          UCC filings are public records. Most states let you search them online, often
          for free, by your company&rsquo;s exact legal name. When you look, check:
        </P>
        <List
          items={[
            <><strong>Who filed it</strong> — listed as the &ldquo;secured party.&rdquo;</>,
            <><strong>When it was filed</strong> — filings generally last five years unless the lender renews them.</>,
            <><strong>What collateral it lists</strong> — just receivables, or everything?</>,
            <><strong>Whether it&rsquo;s still active</strong> — or tied to a loan you paid off long ago.</>,
          ]}
        />

        <Callout title="Paid off a loan? Clean up the filing.">
          <p>
            If you find a filing for a loan you&rsquo;ve already paid off, ask that lender
            to file a <strong>UCC-3 termination</strong>. Lenders don&rsquo;t always do it
            automatically, and an old filing can get in the way of new funding. Clearing
            it is usually just a phone call or an email.
          </p>
        </Callout>

        <H2>The bottom line</H2>
        <P>
          A UCC filing is a normal part of business funding. Knowing what&rsquo;s on file
          — and telling any new funder about it upfront — saves time and avoids
          surprises. If you&rsquo;re not sure what&rsquo;s on your record, give us a
          call; we look at these every day and are happy to help you make sense of it.
        </P>
        <P>
          Comparing your options? Read{" "}
          <TextLink to="/blog/line-of-credit-vs-invoice-funding">
            Line of Credit vs. Invoice Funding
          </TextLink>
          .
        </P>

        <p className="text-sm text-muted-foreground mt-10 border-t border-border pt-5">
          This article is general information, not legal advice. For questions about
          your specific filings or agreements, talk to an attorney.
        </p>
      </>
    ),
  },
];

export function findArticle(slug: string | undefined): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
