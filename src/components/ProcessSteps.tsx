import { ClipboardCheck, Handshake, Send, DollarSign } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  { icon: ClipboardCheck, step: "Step 1", title: "Apply", desc: "Complete form & become a client" },
  { icon: Handshake, step: "Step 2", title: "Service", desc: "You deliver your products or services" },
  { icon: Send, step: "Step 3", title: "Send", desc: "Send your invoices to us" },
  { icon: DollarSign, step: "Step 4", title: "Get Paid", desc: "We verify & pay you within 24 hours" },
];

const ProcessSteps = () => (
  <section className="section-padding bg-secondary/50">
    <div className="container-wide">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground">Our Process</h2>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        {steps.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.12 }}
            className="text-center group"
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-primary flex items-center justify-center mb-6 group-hover:bg-accent transition-colors duration-300 shadow-lg">
              <s.icon className="h-9 w-9 text-primary-foreground" />
            </div>
            <p className="text-accent font-bold text-sm uppercase tracking-wide mb-1">{s.step}</p>
            <h3 className="text-xl font-display font-bold text-foreground mb-2">{s.title}</h3>
            <p className="text-muted-foreground text-sm">{s.desc}</p>
            {i < steps.length - 1 && (
              <div className="hidden lg:block absolute" />
            )}
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default ProcessSteps;
