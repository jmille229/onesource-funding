import { ClipboardCheck, Send, DollarSign } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  { icon: ClipboardCheck, step: "Step 1", title: "Onboard", desc: "Complete onboarding documents" },
  { icon: Send, step: "Step 2", title: "Submit", desc: "Once approved, submit invoices and receive funding approval within hours" },
  { icon: DollarSign, step: "Step 3", title: "Get Paid", desc: "Receive up to 90% of invoice amount deposited directly into your account, often same day" },
];

const ProcessSteps = () => (
  <section className="section-padding bg-secondary/50">
    <div className="container-wide">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground">Our Process</h2>
      </div>
      <div className="grid sm:grid-cols-1 lg:grid-cols-3 gap-8">
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
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default ProcessSteps;
