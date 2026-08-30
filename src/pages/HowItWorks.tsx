import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ClipboardCheck, Send, DollarSign, Check, X, ArrowRight, Shield,
} from "lucide-react";
import TopBar from "@/components/TopBar";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

/**
 * /how-it-works
 *
 * Expands the three steps from the homepage's Our Process strip. The homepage
 * gives one line per step; this page gives a visitor enough to decide, which is
 * the job of a second-click page.
 *
 * Step one carries the weight. The reason a contractor hesitates is that they
 * expect a bank-style process — hand over your books, your payroll system, your
 * customer list, wait weeks. Saying "we don't need those" in prose gets skimmed
 * past, so it is set as an explicit have/haven't-got comparison. Two columns of
 * ticks and crosses is the one layout people actually read, because it answers
 * the objection in the same glance that raises it.
 *
 * Claims are reused verbatim from the homepage rather than invented: approval
 * within hours, up to 90% of the invoice, often same day.
 */

const NEED = [
  "A signed application",
  "Your business formation documents",
  "A copy of the invoice you want funded",
  "The contract or purchase order behind it",
];

const DONT_NEED = [
  "Access to your accounting software",
  "Access to your payroll system",
  "Audited financial statements",
  "Your vendor or supplier data",
];

const STEPS = [
  {
    icon: ClipboardCheck,
    n: "01",
    title: "Onboard",
    lede: "A short application, not an audit.",
    body:
      "One Source needs a handful of documents to get you set up — and that is genuinely all. " +
      "We do not connect to your systems or ask you to open your books.",
  },
  {
    icon: Send,
    n: "02",
    title: "Submit",
    lede: "Send us the invoice once the work is done.",
    body:
      "Once you are approved, submit invoices and receive funding approval within hours. " +
      "No new application each time — approved clients simply send the next invoice.",
  },
  {
    icon: DollarSign,
    n: "03",
    title: "Get paid",
    lede: "Cash in your account, not in 90 days.",
    body:
      "Receive up to 90% of the invoice amount deposited directly into your account, often same day. " +
      "We wait on the agency's payment cycle so you do not have to.",
  },
];

const HowItWorks = () => {
  const reduce = useReducedMotion();
  const rise = (i: number) =>
    reduce
      ? { initial: { opacity: 1 }, whileInView: { opacity: 1 } }
      : {
          initial: { opacity: 0, y: 24 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-80px" },
          transition: { duration: 0.5, delay: i * 0.1 },
        };

  return (
    <div className="min-h-screen">
      <TopBar />
      <Navbar />

      <main>
        {/* ── Page header ─────────────────────────────────────────────────── */}
        <section className="bg-hero">
          <div className="container-wide px-4 sm:px-6 lg:px-8 pt-12 pb-14 md:pt-16 md:pb-20">
            <div className="max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 bg-accent/15 border border-accent/40 text-accent rounded-full px-4 py-1.5 mb-5">
                <Shield className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold uppercase tracking-widest">
                  {/* Same two-line wrap at 390px as the homepage chip; same fix,
                      so the two pages stay consistent. */}
                  <span className="sm:hidden">For Government Contractors</span>
                  <span className="hidden sm:inline">Exclusively for U.S. Government Contractors</span>
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-primary-foreground leading-[1.1] tracking-tight mb-5 text-balance">
                How it works
              </h1>
              <p className="text-primary-foreground/90 text-base md:text-lg leading-relaxed">
                Three steps between finished work and money in your account. No new
                application for every invoice, and no handing over your books to get
                started.
              </p>
            </div>
          </div>
        </section>

        {/* ── The three steps ─────────────────────────────────────────────── */}
        <section className="section-padding bg-background">
          <div className="container-wide px-4 sm:px-6 lg:px-8">
            <ol className="space-y-12 md:space-y-16 list-none max-w-3xl mx-auto">
              {STEPS.map((s, i) => (
                <motion.li key={s.title} {...rise(i)}>
                  <div className="grid md:grid-cols-[auto_1fr] gap-5 md:gap-8">
                    <div className="flex md:flex-col items-center md:items-start gap-4 md:gap-3">
                      <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg shrink-0">
                        <s.icon className="h-7 w-7 md:h-8 md:w-8 text-primary-foreground" aria-hidden="true" />
                      </div>
                      <span
                        className="font-display font-bold text-2xl md:text-3xl text-accent tabular-nums"
                        aria-hidden="true"
                      >
                        {s.n}
                      </span>
                    </div>

                    <div className="max-w-2xl">
                      {/* The step number is decorative above; the accessible name
                          lives here so a screen reader hears "Step 1: Onboard". */}
                      <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-2">
                        <span className="sr-only">Step {i + 1}: </span>
                        {s.title}
                      </h2>
                      <p className="text-lg md:text-xl font-semibold text-foreground/90 mb-3">
                        {s.lede}
                      </p>
                      <p className="text-muted-foreground leading-relaxed">{s.body}</p>

                      {/* Step one gets the comparison, because "we won't ask for
                          your financials" is the single most persuasive thing on
                          this page and the easiest to miss in prose. */}
                      {i === 0 && (
                        <div className="mt-7 grid sm:grid-cols-2 gap-4">
                          <div className="rounded-xl border border-accent/30 bg-accent/5 p-5">
                            <h3 className="font-display font-bold text-foreground mb-3 text-sm uppercase tracking-wide">
                              What we ask for
                            </h3>
                            <ul className="space-y-2.5">
                              {NEED.map((item) => (
                                <li key={item} className="flex gap-2.5 text-sm text-foreground/90">
                                  <Check
                                    className="h-4 w-4 mt-0.5 shrink-0 text-accent"
                                    aria-hidden="true"
                                  />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="rounded-xl border border-border bg-secondary/40 p-5">
                            <h3 className="font-display font-bold text-foreground mb-3 text-sm uppercase tracking-wide">
                              What we never ask for
                            </h3>
                            <ul className="space-y-2.5">
                              {DONT_NEED.map((item) => (
                                <li key={item} className="flex gap-2.5 text-sm text-muted-foreground">
                                  <X className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Close ───────────────────────────────────────────────────────── */}
        <section className="bg-dark-section">
          <div className="container-wide px-4 sm:px-6 lg:px-8 py-14 md:py-16 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-3 text-balance">
              Ready to stop waiting on the agency?
            </h2>
            <p className="opacity-90 mb-7 max-w-xl mx-auto">
              Start with the application. It takes a few documents, and no access to
              anything you would rather keep to yourself.
            </p>
            <Link
              to="/#get-started"
              className="btn-accent text-base px-7 py-3.5 group focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                         focus-visible:ring-offset-primary"
            >
              Apply Now
              <ArrowRight
                className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default HowItWorks;
