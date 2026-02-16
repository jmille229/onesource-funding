import { motion } from "framer-motion";
import locationsMap from "@/assets/locations-map.png";

const LocationsSection = () => (
  <section id="locations" className="section-padding">
    <div className="container-wide">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6">
            Find a Location Near You
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-8">
            Companies across the United States and Canada depend on us to deliver reliable local service to support their daily cash flow needs. Wherever you are, we have an office with experienced professionals ready to serve you.
          </p>
          <a href="#locations" className="btn-accent">
            View All Locations
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          <img
            src={locationsMap}
            alt="Map showing office locations across North America"
            className="w-full rounded-2xl shadow-xl"
          />
        </motion.div>
      </div>
    </div>
  </section>
);

export default LocationsSection;
