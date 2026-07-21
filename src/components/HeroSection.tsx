import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import heroPhone from "@/assets/hero-phone.png";

const HeroSection = () => (
  <section className="bg-hero relative overflow-hidden">
    <div className="container-wide px-4 sm:px-6 lg:px-8 py-16 md:py-24 lg:py-32">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
        >
          <div className="inline-flex items-center gap-2 bg-accent/15 border border-accent/40 text-accent rounded-full px-4 py-1.5 mb-6">
            <Shield className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Exclusively for U.S. Government Contractors
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-primary-foreground leading-tight mb-6">
            Funding Built for the Government Market
          </h1>
          <p className="text-primary-foreground/80 text-lg md:text-xl mb-8 max-w-lg">
            One Source Funding works exclusively with contractors serving federal, state, and
            local government agencies. Get paid on your government invoices in hours — not months.
          </p>
          <div className="flex flex-wrap gap-4">
            <a href="#get-started" className="btn-accent text-base px-8 py-4">
              Get Started
            </a>
            <a href="#difference" className="btn-outline-light text-base px-8 py-4">
              Learn More
            </a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="flex justify-center"
        >
          <img
            src={heroPhone}
            alt="Mobile app showing invoice payment confirmation"
            className="w-full max-w-md lg:max-w-lg drop-shadow-2xl"
          />
        </motion.div>
      </div>
    </div>
    {/* Decorative wave */}
    <div className="absolute bottom-0 left-0 right-0">
      <svg viewBox="0 0 1440 80" fill="none" className="w-full">
        <path d="M0 80L60 70C120 60 240 40 360 33.3C480 27 600 33 720 40C840 47 960 53 1080 50C1200 47 1320 33 1380 26.7L1440 20V80H1380C1320 80 1200 80 1080 80C960 80 840 80 720 80C600 80 480 80 360 80C240 80 120 80 60 80H0Z" fill="hsl(210 20% 98%)" />
      </svg>
    </div>
  </section>
);

export default HeroSection;
