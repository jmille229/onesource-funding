import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Shield, ArrowRight } from "lucide-react";
import heroPhone from "@/assets/hero-phone.png";

/**
 * The homepage hero — one hero, not two.
 *
 * This page previously opened with a full-viewport text masthead and *then* this
 * section, roughly 1,330px of stacked hero before any content. Three things were
 * wrong with that beyond the height:
 *
 *   1. Nothing above the fold asked for the sale. A visitor's entire first screen
 *      was a company name, a rhetorical question and a sign-off, with the only
 *      call to action a small button in the nav. For a page whose job is
 *      generating leads, that is the whole ballgame.
 *   2. Two <h1> elements. Screen readers announce the document outline from
 *      headings, and two competing top-level headings make the page's subject
 *      ambiguous. Search engines treat it the same way.
 *   3. The value proposition was set in muted grey on near-white — measured at
 *      3.94:1, under the 4.5:1 WCAG AA needs at that size. The single most
 *      important sentence on the page was the hardest to read.
 *
 * So the masthead is gone and its message lives here, above the fold, next to a
 * button. Padding is roughly half what the two sections used together.
 */
const HeroSection = () => {
  // Respect the OS "reduce motion" setting rather than sliding content in
  // regardless. Vestibular triggers are a real accessibility concern, and a hero
  // that animates on every load is exactly the kind of thing that sets them off.
  const reduce = useReducedMotion();
  const enter = (x: number) =>
    reduce
      ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
      : {
          initial: { opacity: 0, x },
          animate: { opacity: 1, x: 0 },
        };

  return (
    <section className="bg-hero relative overflow-hidden">
      <div className="container-wide px-4 sm:px-6 lg:px-8 pt-10 pb-14 md:pt-16 md:pb-24 lg:pt-20 lg:pb-28">
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-12 items-center">
          <motion.div {...enter(-32)} transition={{ duration: 0.6 }}>
            {/* Qualifies the visitor in one line: if you don't sell to government,
                this isn't for you, and that's deliberate. */}
            <div className="inline-flex items-center gap-2 bg-accent/15 border border-accent/40 text-accent rounded-full px-4 py-1.5 mb-5">
              <Shield className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-widest">
                {/* Wrapped to two lines at 390px, which made the chip look broken.
                    The TopBar already states "U.S." above, so dropping it on
                    phones costs nothing. */}
                <span className="sm:hidden">For Government Contractors</span>
                <span className="hidden sm:inline">Exclusively for U.S. Government Contractors</span>
              </span>
            </div>

            {/* Leads with the reader's problem rather than our name. They already
                know who they are; they don't yet know we solve this. */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-primary-foreground leading-[1.1] tracking-tight mb-5 text-balance">
              Tired of waiting 30, 60, 90+ days to get paid?
            </h1>

            {/* Bumped from /80 to /90 and capped near 60 characters per line —
                the comfortable measure for sustained reading. */}
            <p className="text-primary-foreground/90 text-base md:text-lg leading-relaxed mb-8 max-w-xl">
              For government vendors and contractors, One Source Funding is the easy
              solution to your cash flow needs. We turn invoices for completed work
              into cash — so you stop financing the agency&rsquo;s payment cycle.
            </p>

            <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4">
              <a
                href="#get-started"
                className="btn-accent text-base px-7 py-3.5 group focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2
                           focus-visible:ring-offset-primary"
              >
                Apply Now
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
                How it works
              </Link>
            </div>
          </motion.div>

          {/* Decorative on small screens — the phone adds no information a screen
              reader needs, and hiding it below lg keeps the CTA above the fold on
              a handset, which is where most of this traffic will land. */}
          <motion.div
            {...enter(32)}
            transition={{ duration: 0.6, delay: reduce ? 0 : 0.15 }}
            className="hidden lg:flex justify-center"
          >
            <img
              src={heroPhone}
              alt=""
              aria-hidden="true"
              width={480}
              height={480}
              className="w-full max-w-sm xl:max-w-md rounded-2xl ring-1 ring-white/15 shadow-2xl"
              fetchPriority="high"
            />
          </motion.div>
        </div>
      </div>

      {/* Decorative wave */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none" aria-hidden="true">
        <svg viewBox="0 0 1440 80" fill="none" className="w-full" role="presentation">
          <path
            d="M0 80L60 70C120 60 240 40 360 33.3C480 27 600 33 720 40C840 47 960 53 1080 50C1200 47 1320 33 1380 26.7L1440 20V80H1380C1320 80 1200 80 1080 80C960 80 840 80 720 80C600 80 480 80 360 80C240 80 120 80 60 80H0Z"
            fill="hsl(210 20% 98%)"
          />
        </svg>
      </div>
    </section>
  );
};

export default HeroSection;
