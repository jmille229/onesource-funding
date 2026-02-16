import { motion } from "framer-motion";
import USCoverageMap from "@/components/USCoverageMap";

const LocationsSection = () => (
  <section id="locations" className="section-padding">
    <div className="container-wide">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
          States We Cover
        </h2>
        <p className="text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          We proudly serve businesses across 46 states. See our coverage area below.
        </p>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="max-w-4xl mx-auto"
      >
        <USCoverageMap />
        <div className="flex items-center justify-center gap-8 mt-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-accent" />
            <span className="text-muted-foreground">Covered</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-muted border border-border" />
            <span className="text-muted-foreground">Not Covered</span>
          </div>
        </div>
      </motion.div>
    </div>
  </section>
);

export default LocationsSection;
