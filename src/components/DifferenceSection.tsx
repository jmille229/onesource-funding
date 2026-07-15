import { motion } from "framer-motion";
import officeImg from "@/assets/office-building.jpg";

const DifferenceSection = () => (
  <section id="difference" className="section-padding">
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
            Built for Government Contractors
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            One Source Funding provides non-recourse invoice factoring built specifically for contractors serving federal, state, and local government agencies. We turn your government receivables into working capital — fast.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-8">
            We understand government payment cycles and the paperwork that comes with them. Our team works directly with government contractors to fund invoices in hours — not the 30, 60, or 90+ days agencies often take to pay.
          </p>
          <a href="#get-started" className="btn-accent">
            Find Out More
          </a>
        </motion.div>
      </div>
    </div>
  </section>
);

export default DifferenceSection;
