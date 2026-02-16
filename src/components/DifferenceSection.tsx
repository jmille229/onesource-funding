import { motion } from "framer-motion";
import officeImg from "@/assets/office-building.jpg";

const DifferenceSection = () => (
  <section className="section-padding">
    <div className="container-wide">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <img
            src={officeImg}
            alt="Corporate office building"
            className="rounded-2xl shadow-2xl w-full object-cover aspect-[4/3]"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          <p className="text-accent font-semibold text-sm uppercase tracking-widest mb-3">
            The Difference
          </p>
          <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6">
            A Leader in Business Financing Since 1969
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Nationally recognized as a leader in business financing and a top invoice factoring company. We provide full-service, non-recourse invoice factoring to growing companies across North America.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-8">
            We maintain offices throughout North America to provide face-to-face service and expert financial solutions to small and medium-sized businesses. Currently serving more than 2,000 clients with an excellent credit rating.
          </p>
          <a href="#about" className="btn-accent">
            Find Out More
          </a>
        </motion.div>
      </div>
    </div>
  </section>
);

export default DifferenceSection;
