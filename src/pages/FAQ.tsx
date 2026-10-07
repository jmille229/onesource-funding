import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import ContentPage, { H2, P, TextLink } from "@/components/ContentPage";
import { CONTACT } from "@/lib/contact";

/**
 * /faq — the homepage "Funding FAQ" card's Read More, and the Resources → FAQs
 * menu item.
 *
 * Built on native <details>/<summary>: keyboard and screen-reader accessible
 * with no script, and the answers stay in the page source when collapsed, so
 * search engines index every answer, not just the questions.
 *
 * Answers only state what the business does today. Where the honest answer is
 * "it depends on your agreement", the answer says so and points to a call
 * rather than inventing a number.
 */

interface QA { q: string; a: ReactNode }

const SECTIONS: Array<{ title: string; items: QA[] }> = [
  {
    title: "The basics",
    items: [
      {
        q: "What is invoice funding?",
        a: (
          <>
            It&rsquo;s a way to get paid now for invoices your customers will pay later.
            You send us an invoice for work you&rsquo;ve finished, we pay you most of it
            upfront, and you get the rest (minus our fee) when the agency pays. Our{" "}
            <TextLink to="/invoice-funding">plain-English explainer</TextLink> walks
            through a real-world example.
          </>
        ),
      },
      {
        q: "Is invoice funding the same thing as factoring?",
        a: (
          <>
            Yes. &ldquo;Invoice factoring&rdquo; is the traditional industry name for the
            same thing. We call it invoice funding because that&rsquo;s what it does
            for you — it funds work you&rsquo;ve already done. You may also see it called
            receivables financing.
          </>
        ),
      },
      {
        q: "Is this a loan?",
        a: (
          <>
            Not in the usual sense. A loan is based on your credit and is repaid from
            your future income. Invoice funding is based on an invoice you&rsquo;ve
            already earned, and it&rsquo;s settled when your customer pays that invoice.
            For how it should appear in your books, check with your accountant.
          </>
        ),
      },
      {
        q: "Who do you work with?",
        a: (
          <>
            Businesses that bill government agencies — contractors, vendors and service
            providers working for cities, counties, states, housing and redevelopment
            authorities and other public bodies. If a government agency owes you money
            for completed work, we&rsquo;d like to hear from you.
          </>
        ),
      },
    ],
  },
  {
    title: "Getting started",
    items: [
      {
        q: "What do I need to apply?",
        a: (
          <>
            A signed application, your business formation documents, a copy of the
            invoice you want funded, and the contract or purchase order behind it.
            That&rsquo;s it. <TextLink to="/how-it-works">See how it works</TextLink>.
          </>
        ),
      },
      {
        q: "Do you need access to my accounting software or payroll?",
        a: (
          <>
            No. We don&rsquo;t log into your accounting software or payroll system, we
            don&rsquo;t need audited financial statements, and we don&rsquo;t need your
            vendor or supplier lists. Your books stay yours.
          </>
        ),
      },
      {
        q: "My credit isn't perfect. Can I still qualify?",
        a: (
          <>
            Often, yes. Because we&rsquo;re funding invoices owed by government agencies,
            the agency&rsquo;s ability to pay matters more than your personal credit
            score. We do review things like tax liens and court judgments as part of
            getting you set up, so it&rsquo;s best to tell us about anything like that
            upfront.
          </>
        ),
      },
      {
        q: "I already have a bank loan or line of credit. Can I still use invoice funding?",
        a: (
          <>
            In many cases, yes. If your lender has a lien on your receivables, the two
            arrangements need to be coordinated, which usually means a short agreement
            with your bank. Mention it early and we&rsquo;ll help sort it out. Our guide
            to <TextLink to="/blog/understanding-ucc-filings">UCC filings</TextLink>{" "}
            explains what to look for.
          </>
        ),
      },
    ],
  },
  {
    title: "Money and timing",
    items: [
      {
        q: "How fast can I get paid?",
        a: (
          <>
            Once your account is set up, you submit an invoice and get an approval
            decision within hours — and the money is often in your account the same
            day. Getting set up the first time takes a little longer while we review your
            documents.
          </>
        ),
      },
      {
        q: "How much of my invoice do I get upfront?",
        a: (
          <>
            Most of it — typically around 80% of the invoice amount. The remaining
            balance, minus our fee, comes to you when the agency pays.
          </>
        ),
      },
      {
        q: "How much does it cost?",
        a: (
          <>
            Our fee is based on how long the agency takes to pay the invoice: the sooner
            they pay, the less it costs you. Before you sign anything, we&rsquo;ll show
            you exactly how the fee works on your invoices, so you can decide with real
            numbers in front of you.
          </>
        ),
      },
      {
        q: "Do I have to fund all of my invoices?",
        a: (
          <>
            No. You choose which invoices to fund and when. Fund one when an agency is
            running slow, and keep the next one if you don&rsquo;t need the cash.
          </>
        ),
      },
    ],
  },
  {
    title: "Day to day",
    items: [
      {
        q: "Will the agency know I'm using invoice funding?",
        a: (
          <>
            Usually, yes. For invoices we fund, the agency is typically asked to send
            payment to us rather than to you. It&rsquo;s a routine step that agencies see
            regularly, and it doesn&rsquo;t change your relationship with them — you keep
            doing the work and dealing with your contacts the way you always have.
          </>
        ),
      },
      {
        q: "What happens if the agency pays late?",
        a: (
          <>
            Government agencies paying late is exactly why invoice funding exists, so
            it&rsquo;s expected. Because the fee is tied to how long the agency takes, a
            slower payment does cost more. Your agreement spells out what happens if an
            invoice stays unpaid for a long time, and we&rsquo;ll walk you through it
            before you sign.
          </>
        ),
      },
      {
        q: "Will you file a UCC lien on my business?",
        a: (
          <>
            Yes — like nearly every lender and funder, we file a UCC-1 financing
            statement. It&rsquo;s a routine public notice, not a sign that anything is
            wrong. Read{" "}
            <TextLink to="/blog/understanding-ucc-filings">Understanding UCC Filings</TextLink>{" "}
            for a plain-English explanation.
          </>
        ),
      },
      {
        q: "Is your project management software really free?",
        a: (
          <>
            Yes. Any government contractor can use it to manage jobs, budgets, invoices
            and subcontractors, with no obligation to ever fund an invoice with us.{" "}
            <TextLink to="/software">Learn more about the software</TextLink>.
          </>
        ),
      },
    ],
  },
];

const FAQ = () => (
  <ContentPage
    eyebrow="Questions & answers"
    heading="Your questions, answered"
    lede={
      <>
        Straight answers to the questions business owners ask us most. Don&rsquo;t see
        yours? Call us — we&rsquo;re happy to help, even if you&rsquo;re just exploring.
      </>
    }
    meta={{
      title: "Invoice Funding & Factoring FAQ for Government Contractors | One Source Funding",
      description:
        "Answers to common questions about invoice funding (invoice factoring): what it costs, how fast you get paid, what you need to apply, credit, UCC filings and more.",
      path: "/faq",
    }}
  >
    {SECTIONS.map((section) => (
      <div key={section.title}>
        <H2>{section.title}</H2>
        <div className="mb-10 divide-y divide-border rounded-xl border border-border bg-card">
          {section.items.map((item) => (
            <details key={item.q} className="group">
              <summary
                className="flex cursor-pointer list-none items-start justify-between gap-4 p-5 md:p-6
                           font-display font-semibold text-foreground text-base md:text-lg
                           hover:text-accent transition-colors [&::-webkit-details-marker]:hidden
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                           focus-visible:ring-inset rounded-xl"
              >
                {item.q}
                <ChevronDown
                  className="h-5 w-5 mt-0.5 shrink-0 text-accent transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="px-5 md:px-6 pb-5 md:pb-6 -mt-1 text-foreground/85 text-base md:text-lg leading-relaxed">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    ))}

    <H2>Still have a question?</H2>
    <P>
      Call us at{" "}
      <a href={`tel:${CONTACT.phoneTel}`} className="text-accent font-semibold underline underline-offset-2 decoration-accent/40 hover:decoration-accent">
        {CONTACT.phone}
      </a>{" "}
      or email{" "}
      <a href={`mailto:${CONTACT.email}`} className="text-accent font-semibold underline underline-offset-2 decoration-accent/40 hover:decoration-accent">
        {CONTACT.email}
      </a>
      . You&rsquo;ll talk to a real person who can answer it.
    </P>
  </ContentPage>
);

export default FAQ;
