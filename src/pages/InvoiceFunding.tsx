import ContentPage, { Callout, H2, List, P, TextLink } from "@/components/ContentPage";

/**
 * /invoice-funding — "What is invoice funding?"
 *
 * The homepage card's Read More, and the page a search for "what is invoice
 * factoring" should land on. Written for someone who has never used it: one
 * worked example with real-looking numbers does more than three paragraphs of
 * definition.
 *
 * The example's numbers are illustrative, not a quote — it says so on the page.
 * Advance: typically 80%, up to 90% in some circumstances. Funding is full
 * recourse, and the page says so plainly rather than leaving it to the contract.
 */

const InvoiceFunding = () => (
  <ContentPage
    eyebrow="The basics"
    heading="What is invoice funding?"
    lede={
      <>
        You finished the job. You sent the invoice. Now the agency says it&rsquo;ll pay
        in 60 days — maybe 90. Invoice funding closes that gap, so the money you&rsquo;ve
        already earned shows up when you actually need it.
      </>
    }
    meta={{
      title: "What Is Invoice Funding? Invoice Factoring for Contractors, Explained | One Source Funding",
      description:
        "Invoice funding (invoice factoring) means getting paid now for invoices your customers will pay later. How it works, what it costs, and whether it fits your business.",
      path: "/invoice-funding",
    }}
  >
    <H2>The short version</H2>
    <P>
      Invoice funding means getting paid now for an invoice your customer will pay
      later. You send us an invoice for work you&rsquo;ve completed, we pay you most of
      it right away, and when the agency pays, you get the rest — minus our fee.
    </P>
    <P>
      You may also hear it called <strong>invoice factoring</strong> or receivables
      financing. Different names, same basic idea: turning money you&rsquo;re owed into
      money you have.
    </P>

    <H2>A real-world example</H2>
    <P>
      Say you run a painting company. You just finished repainting the halls of a
      county building and sent a $12,000 invoice. The county&rsquo;s terms are net 45,
      but anyone who has billed a public agency knows that 45 days has a way of
      becoming 60, or 90.
    </P>
    <P>
      Meanwhile, your crew still needs to be paid on Friday. Your supplier still wants
      paying for the paint. And there&rsquo;s another job you&rsquo;d like to bid on
      next week.
    </P>
    <Callout title="How that invoice could play out">
      <List
        ordered
        items={[
          "You send us the $12,000 invoice, along with the contract or purchase order behind it.",
          <>We advance you most of it upfront — typically 80%, so about <strong>$9,600</strong> in your account. (In some cases we can advance up to 90%.)</>,
          "Your crew gets paid, the supplier gets paid, and you bid the next job.",
          "When the county pays the invoice, we send you the remaining balance, minus our fee.",
        ]}
      />
      <p className="text-sm text-muted-foreground">
        Numbers are for illustration only. Your actual advance and fee depend on the
        invoice and the agency.
      </p>
    </Callout>

    <H2>What does it cost?</H2>
    <P>
      You pay a fee for getting your money early. With us, that fee is tied to how long
      the agency takes to pay: the faster they pay, the less it costs you. There are no
      surprises buried in the paperwork — before you sign anything, we&rsquo;ll walk you
      through exactly how the fee works on your invoices.
    </P>
    <P>
      The honest way to think about the cost is to compare it with what waiting costs
      you: the job you couldn&rsquo;t take, the late fee from your supplier, or the
      balance sitting on a credit card.
    </P>

    <H2>Isn&rsquo;t this just a loan?</H2>
    <P>
      Not really. A loan is based on your credit and gets repaid out of your future
      income. Invoice funding is based on work you&rsquo;ve already done, and it&rsquo;s
      settled when your customer pays the invoice. You&rsquo;re not borrowing against
      your business — you&rsquo;re getting paid sooner for it.
    </P>
    <P>
      That&rsquo;s also why the agency you work for matters more than your credit score.
      Government agencies are about as reliable as customers get. The question is
      usually <em>when</em> they&rsquo;ll pay, not <em>whether</em>. (How it shows up in
      your books is a good question for your accountant.)
    </P>

    <H2>What if the agency doesn&rsquo;t pay?</H2>
    <P>
      We&rsquo;d rather you hear this from us upfront than find it in the fine print: our
      funding is <strong>full recourse</strong>. That means if an agency doesn&rsquo;t pay
      a funded invoice within the time set out in your agreement, you&rsquo;re responsible
      for paying back the advance on that invoice. Your agreement spells out exactly how
      that works, and we&rsquo;ll walk you through it before you sign.
    </P>
    <P>
      In practice, with government customers it rarely comes to that. Agencies almost
      always pay — the problem is how long they take.
    </P>

    <H2>Who it&rsquo;s a good fit for</H2>
    <P>
      We work only with businesses that bill government agencies. Invoice funding tends
      to fit well if:
    </P>
    <List
      items={[
        "You do work for a city, county or state agency, a housing or redevelopment authority, a school district, or another public body.",
        "Your invoices are for work that's already completed — including progress billings for finished phases of a bigger job.",
        "Business is good, but waiting 30, 60 or 90+ days to get paid keeps squeezing your cash.",
        "You'd like to grow, take on bigger contracts, or simply stop worrying about payroll week.",
      ]}
    />

    <H2>When it might not be right</H2>
    <P>
      We&rsquo;d rather tell you upfront. Invoice funding probably isn&rsquo;t the right
      tool if your customers already pay you quickly, if you&rsquo;re looking for money
      for work you haven&rsquo;t started yet, or if a bank line of credit at a good rate
      already covers what you need. We wrote a plain comparison of the two —{" "}
      <TextLink to="/blog/line-of-credit-vs-invoice-funding">
        Line of Credit vs. Invoice Funding
      </TextLink>{" "}
      — if you&rsquo;re weighing them up.
    </P>

    <H2>Ready to see how it would work for you?</H2>
    <P>
      Getting started takes a short application and a few documents — not an audit of
      your books. See <TextLink to="/how-it-works">how it works</TextLink> step by step,
      browse the <TextLink to="/faq">common questions</TextLink>, or just give us a call.
      We&rsquo;re happy to talk it through, even if you&rsquo;re only exploring.
    </P>
  </ContentPage>
);

export default InvoiceFunding;
