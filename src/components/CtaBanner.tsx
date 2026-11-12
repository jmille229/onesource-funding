import { motion } from "framer-motion";
import { APPLY_URL } from "@/lib/links";

const CtaBanner = () => (
  <section className="bg-hero">
    <div className="container-wide px-4 sm:px-6 lg:px-8 py-16 md:py-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="text-center"
      >
        <p className="text-accent font-semibold text-sm uppercase tracking-widest mb-3">
          Why Wait?
        </p>
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-primary-foreground mb-8">
          Start Getting Paid Immediately
        </h2>
        <a href={APPLY_URL} className="btn-accent text-lg px-10 py-4">
          Apply Now
        </a>
      </motion.div>
    </div>
  </section>
);

export default CtaBanner;
