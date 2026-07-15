import { FileText, Settings, Building2 } from "lucide-react";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

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

const consultationSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(80),
  lastName: z.string().trim().min(1, "Last name is required.").max(80),
  email: z.string().trim().email("Enter a valid email address.").max(320),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a valid phone number.")
    .max(25)
    .regex(/^[0-9+().\-\s]+$/, "Enter a valid phone number."),
  company: z.string().trim().max(120).optional(),
  message: z.string().trim().max(2000).optional(),
});

type ConsultationForm = z.infer<typeof consultationSchema>;

const inputClass =
  "w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-dark-section-foreground placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-accent aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-400";

const GetStartedSection = () => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ConsultationForm>({
    resolver: zodResolver(consultationSchema),
  });

  const onSubmit = async (values: ConsultationForm) => {
    try {
      // TODO(onesource): send `values` to the real lead destination.
      // Options: a serverless function that emails the team (Resend/SendGrid),
      // a form service (Formspree/Basin), or a CRM/webhook endpoint. Until that
      // exists, we validate + surface a success state without persisting the lead.
      console.info("[get-started] consultation request (not yet delivered):", values);
      await new Promise((resolve) => setTimeout(resolve, 600));
      toast.success("Thanks! We received your request and will be in touch shortly.");
      reset();
    } catch {
      toast.error("Something went wrong. Please try again or call us directly.");
    }
  };

  return (
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
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="sr-only">First Name</label>
                  <input
                    id="firstName"
                    type="text"
                    placeholder="First Name"
                    autoComplete="given-name"
                    aria-invalid={!!errors.firstName}
                    className={inputClass}
                    {...register("firstName")}
                  />
                  {errors.firstName && (
                    <p className="mt-1 text-xs text-red-300">{errors.firstName.message}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="lastName" className="sr-only">Last Name</label>
                  <input
                    id="lastName"
                    type="text"
                    placeholder="Last Name"
                    autoComplete="family-name"
                    aria-invalid={!!errors.lastName}
                    className={inputClass}
                    {...register("lastName")}
                  />
                  {errors.lastName && (
                    <p className="mt-1 text-xs text-red-300">{errors.lastName.message}</p>
                  )}
                </div>
              </div>
              <div>
                <label htmlFor="email" className="sr-only">Email Address</label>
                <input
                  id="email"
                  type="email"
                  placeholder="Email Address"
                  autoComplete="email"
                  aria-invalid={!!errors.email}
                  className={inputClass}
                  {...register("email")}
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-red-300">{errors.email.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="phone" className="sr-only">Phone Number</label>
                <input
                  id="phone"
                  type="tel"
                  placeholder="Phone Number"
                  autoComplete="tel"
                  aria-invalid={!!errors.phone}
                  className={inputClass}
                  {...register("phone")}
                />
                {errors.phone && (
                  <p className="mt-1 text-xs text-red-300">{errors.phone.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="company" className="sr-only">Company Name</label>
                <input
                  id="company"
                  type="text"
                  placeholder="Company Name"
                  autoComplete="organization"
                  aria-invalid={!!errors.company}
                  className={inputClass}
                  {...register("company")}
                />
                {errors.company && (
                  <p className="mt-1 text-xs text-red-300">{errors.company.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="message" className="sr-only">Tell us about your business</label>
                <textarea
                  id="message"
                  placeholder="Tell us about your business..."
                  rows={3}
                  aria-invalid={!!errors.message}
                  className={`${inputClass} resize-none`}
                  {...register("message")}
                />
                {errors.message && (
                  <p className="mt-1 text-xs text-red-300">{errors.message.message}</p>
                )}
              </div>
              <button type="submit" disabled={isSubmitting} className="btn-accent w-full text-base py-4 disabled:opacity-60 disabled:cursor-not-allowed">
                {isSubmitting ? "Submitting..." : "Submit Request"}
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
};

export default GetStartedSection;
