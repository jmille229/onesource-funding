import { motion } from "framer-motion";
import USCoverageMap from "@/components/USCoverageMap";

const LocationsSection = () => (
  <section id="locations" className="section-padding bg-secondary/30">
    <div className="container-wide">
      <div className="text-center mb-12">
        <p className="text-accent font-semibold text-sm uppercase tracking-widest mb-3">
          Nationwide Coverage
        </p>
        <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
          States We Cover
        </h2>
        <p className="text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          We proudly serve government contractors across 46 states. California, North Dakota,
          South Dakota, and North Carolina are not currently serviced.
        </p>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="max-w-5xl mx-auto"
      >
        <USCoverageMap />
      </motion.div>
    </div>
  </section>
);

export default LocationsSection;
