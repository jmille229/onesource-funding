import type { ComponentType, ReactNode } from "react";
import {
  Landmark, ClipboardCheck, Zap, ListChecks, Scale, LayoutDashboard, Phone, BadgeCheck,
} from "lucide-react";
import ContentPage, { H2, P, TextLink } from "@/components/ContentPage";
import { CONTACT } from "@/lib/contact";

/**
 * /why-one-source — the homepage "Why Choose Us" card's Read More.
 *
 * Each reason is something the business actually does today. Deliberately
 * absent: "fastest in the industry", "guaranteed", rates, and any comparison to
 * named competitors — none of which we can back up on the page, and all of which
 * this audience has heard from every funder before.
 */

const REASONS: Array<{ icon: ComponentType<{ className?: string }>; title: string; body: ReactNode }> = [
  {
    icon: Landmark,
    title: "We only work with government contractors",
    body: (
      <>
        That&rsquo;s not a sideline for us — it&rsquo;s the whole business. We know how
        agencies approve and pay invoices, why a payment sits in a queue for weeks, and
        what paperwork they need. You won&rsquo;t have to explain how government billing
        works to the people funding you.
      </>
    ),
  },
  {
    icon: ClipboardCheck,
    title: "A short application, not an audit",
    body: (
      <>
        To get set up, we need a signed application, your business formation documents,
        the invoice and the contract or purchase order behind it. We don&rsquo;t ask to
        log into your accounting software or payroll, and we don&rsquo;t need audited
        financials. <TextLink to="/how-it-works">See exactly what we ask for.</TextLink>
      </>
    ),
  },
  {
    icon: Zap,
    title: "Fast once you're set up",
    body: (
      <>
        After your account is open, there&rsquo;s no new application for every invoice.
        Send us the next one, get an approval decision within hours, and the money is
        often in your account the same day.
      </>
    ),
  },
  {
    icon: ListChecks,
    title: "You choose which invoices to fund",
    body: (
      <>
        Fund one invoice when an agency is dragging its feet. Skip the next one when cash
        is fine. It&rsquo;s your business — you decide when funding makes sense.
      </>
    ),
  },
  {
    icon: Scale,
    title: "A fee that makes sense",
    body: (
      <>
        Our fee is tied to how long the agency actually takes to pay — when they pay
        sooner, you pay less. Before you sign anything, we&rsquo;ll walk you through
        exactly how it works on your invoices, so there are no surprises later.
      </>
    ),
  },
  {
    icon: LayoutDashboard,
    title: "Free software to run your jobs",
    body: (
      <>
        Every contractor gets free access to our project and invoice management
        software — jobs, budgets, invoices and subcontractor paperwork in one place. You don&rsquo;t have to fund a single invoice to use it.{" "}
        <TextLink to="/software">Take a look.</TextLink>
      </>
    ),
  },
  {
    icon: Phone,
    title: "Real people who pick up the phone",
    body: (
      <>
        No call center and no ticket queue. When you have a question about an invoice,
        you talk to the people actually handling it. Call us at{" "}
        <a href={`tel:${CONTACT.phoneTel}`} className="text-accent font-semibold underline underline-offset-2 decoration-accent/40 hover:decoration-accent">
          {CONTACT.phone}
        </a>{" "}
        or email{" "}
        <a href={`mailto:${CONTACT.email}`} className="text-accent font-semibold underline underline-offset-2 decoration-accent/40 hover:decoration-accent">
          {CONTACT.email}
        </a>
        .
      </>
    ),
  },
  {
    icon: BadgeCheck,
    title: "Part of the industry's professional association",
    body: (
      <>
        We&rsquo;re members of the International Factoring Association, the trade group
        for companies that fund invoices. It&rsquo;s one more way we hold ourselves to
        the industry&rsquo;s standards for doing business the right way.
      </>
    ),
  },
];

const WhyOneSource = () => (
  <ContentPage
    eyebrow="Why One Source"
    heading="Built for contractors who bill government agencies"
    lede={
      <>
        You&rsquo;ve probably heard a funding pitch or two. Here&rsquo;s what working with
        us actually looks like — no fine print, no hype.
      </>
    }
    meta={{
      title: "Why One Source Funding? Invoice Factoring Built for Government Contractors",
      description:
        "Invoice funding and factoring built only for businesses that bill government agencies: a short application, approval within hours, you choose which invoices to fund, and real people to talk to.",
      path: "/why-one-source",
    }}
  >
    <div className="space-y-10">
      {REASONS.map((r) => (
        <div key={r.title} className="flex gap-4 md:gap-5">
          <div className="w-12 h-12 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
            <r.icon className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-display font-bold text-foreground mb-2 text-balance">
              {r.title}
            </h2>
            <p className="text-foreground/85 text-base md:text-lg leading-relaxed">{r.body}</p>
          </div>
        </div>
      ))}
    </div>

    <div className="mt-14">
      <H2>Not sure yet? That&rsquo;s fine.</H2>
      <P>
        Plenty of the business owners we talk to are just trying to understand their
        options. Read <TextLink to="/invoice-funding">what invoice funding is</TextLink>,
        browse the <TextLink to="/faq">common questions</TextLink>, or call and ask us
        anything. If funding isn&rsquo;t the right fit for you, we&rsquo;ll say so.
      </P>
    </div>
  </ContentPage>
);

export default WhyOneSource;
