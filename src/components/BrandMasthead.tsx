import { motion } from "framer-motion";

const BrandMasthead = () => (
  <section className="relative bg-background border-b border-border overflow-hidden">
    {/* Subtle top accent bar */}
    <div className="h-1.5 w-full bg-accent" />

    <div className="container-wide px-4 sm:px-6 lg:px-8 py-14 md:py-20 lg:py-24 text-center">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="flex flex-col items-center"
      >
        {/* Company Name */}
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display font-bold text-primary tracking-tight leading-[1]">
          One Source
          <br />
          <span className="text-gradient">Funding</span>
        </h1>

        {/* Decorative line */}
        <div className="mt-6 mb-6 w-24 h-1 bg-accent rounded-full" />

        {/* Tagline */}
        <p className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground max-w-3xl leading-snug">
          You did the work, why should you wait to get paid?
        </p>

        {/* Description */}
        <p className="mt-5 text-base md:text-lg font-semibold text-muted-foreground max-w-2xl leading-relaxed">
          Government vendor or contractor?
          <br />
          Tired of waiting 30, 60, 90+ days for completed work? One Source is the solution to your Cash Flow needs.
        </p>

        {/* Sign-off */}
        <div className="mt-10 flex flex-col items-center">
          <span className="text-lg md:text-xl text-foreground/70 font-medium italic">
            When it comes to funding, there is only…
          </span>
          <span className="mt-2 text-3xl md:text-4xl font-display font-bold text-accent">
            One Source Funding
          </span>
        </div>
      </motion.div>
    </div>

    {/* Bottom decorative fade into hero */}
    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-b from-transparent to-primary/5 pointer-events-none" />
  </section>
);

export default BrandMasthead;
