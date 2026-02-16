import { FileText, Settings, Building2 } from "lucide-react";
import { motion } from "framer-motion";

const services = [
  {
    icon: FileText,
    title: "Invoice Factoring",
    description: "Purchase of accounts receivable for immediate cash. Grow without diluting equity or incurring debt.",
  },
  {
    icon: Settings,
    title: "Services",
    description: "Financing solutions tailored to your cash flow needs. Unlock working capital for growth and expenses.",
  },
  {
    icon: Building2,
    title: "Industries",
    description: "We provide working capital and factoring services to businesses in any industry as long as you invoice your customers.",
  },
];

const GetStartedSection = () => (
  <section id="get-started" className="bg-dark-section">
    <div className="container-wide section-padding">
      <div className="grid lg:grid-cols-2 gap-16">
        {/* Form side */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-2">Get Started</h2>
          <p className="text-dark-section-foreground/70 mb-8">Complete the form for a Free Consultation.</p>
          <form className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="First Name"
                className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-dark-section-foreground placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="text"
                placeholder="Last Name"
                className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-dark-section-foreground placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <input
              type="email"
              placeholder="Email Address"
              className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-dark-section-foreground placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="tel"
              placeholder="Phone Number"
              className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-dark-section-foreground placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="text"
              placeholder="Company Name"
              className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-dark-section-foreground placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <textarea
              placeholder="Tell us about your business..."
              rows={3}
              className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-dark-section-foreground placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-accent resize-none"
            />
            <button type="submit" className="btn-accent w-full text-base py-4">
              Submit Request
            </button>
          </form>
        </motion.div>

        {/* Services side */}
        <div className="space-y-8">
          {services.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="flex gap-5 group cursor-pointer"
            >
              <div className="w-14 h-14 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/30 transition-colors">
                <s.icon className="h-7 w-7 text-accent" />
              </div>
              <div>
                <h3 className="text-xl font-display font-bold mb-2">{s.title}</h3>
                <p className="text-dark-section-foreground/70 leading-relaxed">{s.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default GetStartedSection;
