import { FileText, Shield, HelpCircle } from "lucide-react";
import { motion } from "framer-motion";

const cards = [
  {
    icon: FileText,
    title: "What is Factoring",
    description: "Factoring is the purchase of accounts receivable for immediate cash, empowering businesses to grow without diluting equity or incurring debt.",
    link: "#what-is-factoring",
  },
  {
    icon: Shield,
    title: "Why Choose Us",
    description: "Our entire business process is built around immediate response to client needs and the fastest cash turnaround in the industry. 24-hour funding guaranteed.",
    link: "#why-choose",
  },
  {
    icon: HelpCircle,
    title: "Factoring FAQ",
    description: "We want to address any questions you might have regarding our program. Find answers to common questions about invoice factoring.",
    link: "#faq",
  },
];

const InfoCards = () => (
  <section className="section-padding">
    <div className="container-wide">
      <div className="grid md:grid-cols-2 gap-12 items-start mb-16">
        <div>
          <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
            Can't Wait for Customers to Pay?
          </h2>
          <div className="w-16 h-1 bg-accent rounded-full" />
        </div>
        <p className="text-muted-foreground text-lg leading-relaxed">
          As experts in accounts receivable finance, we provide complete credit services, invoice processing, and receivables management — a full-value package that gives you the cash flow and resources to meet your business objectives.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {cards.map((card, i) => (
          <motion.a
            key={card.title}
            href={card.link}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.15 }}
            className="info-card group"
          >
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-accent/10 transition-colors">
              <card.icon className="h-7 w-7 text-primary group-hover:text-accent transition-colors" />
            </div>
            <h3 className="text-xl font-display font-bold text-foreground mb-3">{card.title}</h3>
            <p className="text-muted-foreground leading-relaxed">{card.description}</p>
            <span className="inline-block mt-4 text-accent font-semibold text-sm group-hover:underline">
              Read More →
            </span>
          </motion.a>
        ))}
      </div>
    </div>
  </section>
);

export default InfoCards;
