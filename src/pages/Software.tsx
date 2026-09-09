import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  FolderKanban, Calculator, Receipt, ClipboardList, Users, BarChart3,
  ArrowRight, Check, Wallet,
} from "lucide-react";
import TopBar from "@/components/TopBar";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

/**
 * /software — the second front door.
 *
 * The homepage sells factoring to a contractor with a cash crunch *today*. This
 * page sells the free project-and-invoice software to a contractor who just
 * wants to run their jobs better and may never factor. They are different buyers
 * in different mindsets, and one page cannot serve both — a software-curious
 * visitor bounces off a page headlined "Invoice Factoring."
 *
 * Strategy (one brand, two doors): the software is genuinely free, with no
 * factoring strings. Every contractor who runs their invoicing here is someone
 * whose cash-flow we can see — the best-qualified, best-timed factoring lead
 * there is. So the funnel works precisely *because* most of these users never
 * factor. The "Why it's free" section says that out loud, because transparency
 * is the differentiator in a category full of factors who cold-call the day you
 * sign your first contract.
 *
 * Front door only: CTAs go to the app's own self-serve sign-up. The contextual
 * in-app funding offer (keyed on invoice age / agency slowdown) is a separate,
 * later piece of work.
 */

// The app deploys separately on its own subdomain; override per env with
// VITE_APP_URL. Same convention as Navbar.
const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? "https://app.os-funding.com";

const FEATURES = [
  {
    icon: FolderKanban,
    title: "Jobs & projects",
    body: "Track every government contract from bid to closeout — status, contract value, dates and the people on it, all in one place.",
  },
  {
    icon: Calculator,
    title: "Budgets & job costing",
    body: "Build a budget per job and watch committed and actual cost against every line, so a job going over is something you see, not something you discover.",
  },
  {
    icon: Receipt,
    title: "Invoicing & AR aging",
    body: "Create and track invoices, and see exactly what each agency owes and how long it has been sitting — aged by 30, 60, 90+ days.",
  },
  {
    icon: Users,
    title: "Subcontractors & participation",
    body: "Manage subcontracts and pay applications, and track MBE / WBE / DBE participation against your goals — the number your agency actually asks for.",
  },
  {
    icon: ClipboardList,
    title: "Daily logs & time",
    body: "Field logs and labor hours recorded against the job they belong to, so your project record and your job cost stay in step.",
  },
  {
    icon: BarChart3,
    title: "Reports",
    body: "A live dashboard plus job-cost and receivables reporting — the view of the business you normally rebuild in a spreadsheet every month.",
  },
];

const Software = () => {
  const reduce = useReducedMotion();
  const rise = (i: number) =>
    reduce
      ? { initial: { opacity: 1 }, whileInView: { opacity: 1 } }
      : {
          initial: { opacity: 0, y: 24 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-80px" },
          transition: { duration: 0.5, delay: i * 0.08 },
        };

  return (
    <div className="min-h-screen">
      <TopBar />
      <Navbar />

      <main>
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <section className="bg-hero">
          <div className="container-wide px-4 sm:px-6 lg:px-8 pt-12 pb-14 md:pt-16 md:pb-20">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 bg-accent/15 border border-accent/40 text-accent rounded-full px-4 py-1.5 mb-5">
                <Wallet className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold uppercase tracking-widest">
                  Free for government contractors
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-primary-foreground leading-[1.1] tracking-tight mb-5 text-balance">
                Run your government contracts, not your spreadsheets.
              </h1>
              <p className="text-primary-foreground/90 text-base md:text-lg leading-relaxed mb-8 max-w-xl">
                One Source gives government contractors a single place to manage
                jobs, budgets, invoices and subcontractor compliance — free, with
                no access to your books and no obligation to ever borrow a dollar.
              </p>
              <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4">
                <a
                  href={`${APP_URL}/register`}
                  className="btn-accent text-base px-7 py-3.5 group focus-visible:outline-none
                             focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                             focus-visible:ring-offset-primary"
                >
                  Start free
                  <ArrowRight
                    className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </a>
                <a
                  href={`${APP_URL}/login`}
                  className="btn-outline-light text-base px-7 py-3.5 focus-visible:outline-none
                             focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                             focus-visible:ring-offset-primary"
                >
                  Sign in
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <section className="section-padding bg-background">
          <div className="container-wide px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-10 md:mb-14">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-3 text-balance">
                Everything a government contractor tracks, in one place
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Built around how you actually work — the contract, the budget, the
                invoice and the subs — not a generic tool you have to bend to fit.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.title}
                  {...rise(i)}
                  className="rounded-2xl border border-border bg-card p-6"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-md mb-4">
                    <f.icon className="h-6 w-6 text-primary-foreground" aria-hidden="true" />
                  </div>
                  <h3 className="font-display font-bold text-foreground mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Why it's free — the honest part ──────────────────────────────── */}
        <section className="section-padding bg-secondary/40">
          <div className="container-wide px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-4 text-balance">
                Why it&rsquo;s free
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Because we&rsquo;re a factoring company, not a software company. We
                make our money the day a contractor decides they&rsquo;d rather not
                wait 60 or 90 days for an agency to pay — so we give away the
                software that helps you run a healthy business, and we&rsquo;re here
                with funding <em>if and when</em> you want it.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-6">
                No trial clock, no credit card, no funding requirement. Use it for
                as long as it&rsquo;s useful. If cash ever gets tight, funding is one
                click away inside the app — and if it never does, that&rsquo;s a
                good outcome for both of us.
              </p>
              <ul className="grid sm:grid-cols-2 gap-3">
                {[
                  "Free to use, indefinitely",
                  "No access to your accounting or payroll",
                  "No obligation to ever factor an invoice",
                  "Funding available inside the app when you want it",
                ].map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm text-foreground/90">
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Close ────────────────────────────────────────────────────────── */}
        <section className="bg-dark-section">
          <div className="container-wide px-4 sm:px-6 lg:px-8 py-14 md:py-16 text-center">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-3 text-balance">
              Start running your contracts the easy way
            </h2>
            <p className="opacity-90 mb-7 max-w-xl mx-auto">
              Create an account and set up your first job in minutes. Free, and
              yours to keep whether or not you ever need funding.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 justify-center">
              <a
                href={`${APP_URL}/register`}
                className="btn-accent text-base px-7 py-3.5 group focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                           focus-visible:ring-offset-primary"
              >
                Start free
                <ArrowRight
                  className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </a>
              <Link
                to="/how-it-works"
                className="btn-outline-light text-base px-7 py-3.5 focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                           focus-visible:ring-offset-primary"
              >
                Or see how funding works
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Software;
