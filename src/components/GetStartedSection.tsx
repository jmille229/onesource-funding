import { useRef } from "react";
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
    title: "Who We Serve",
    description: "We work exclusively with contractors serving federal, state, and local government agencies — funding your government receivables.",
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

import { CONTACT } from "@/lib/contact";

type ConsultationForm = z.infer<typeof consultationSchema>;

/**
 * Where consultation leads are delivered.
 *
 * The general info inbox rather than a named salesperson. A public form dropping
 * every lead to one person's mailbox is fragile (holidays, turnover, spam
 * filters) and a small privacy overshare for a page that anyone can view-source.
 */
const LEAD_EMAIL = CONTACT.email;

/**
 * In-page lead delivery via Web3Forms (https://web3forms.com).
 *
 * The form POSTs JSON to Web3Forms, which emails the lead to the address the
 * access key is registered against (info@os-funding.com) — no email client is
 * opened, and nothing about the flow is visible to the visitor beyond a success
 * toast.
 *
 * The access key is intentionally embeddable: Web3Forms keys are public
 * identifiers meant to sit in client HTML, and abuse is bounded by the allowed-
 * domains restriction set in the Web3Forms dashboard plus their spam filtering,
 * not by keeping the key secret. It can still be overridden at build time with
 * VITE_WEB3FORMS_ACCESS_KEY if the key is ever rotated without a code change.
 */
const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
const WEB3FORMS_ACCESS_KEY =
  (import.meta.env.VITE_WEB3FORMS_ACCESS_KEY as string | undefined) ??
  "84af53e2-3a4f-4651-8a52-f61f778412bb";

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

  // Honeypot: a field no human sees or fills. A bot that dutifully completes
  // every input trips it, and we drop the submission while showing the same
  // success toast a real visitor gets — never revealing that it was caught.
  // This runs ahead of Web3Forms' own server-side spam filtering.
  const honeypotRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (values: ConsultationForm) => {
    if (honeypotRef.current?.value) {
      toast.success("Thanks! We received your request and will be in touch shortly.");
      reset();
      return;
    }

    try {
      const res = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: `New consultation request — ${values.firstName} ${values.lastName}`,
          from_name: "One Source Funding website",
          // So a reply from the notification goes straight to the lead.
          replyto: values.email,
          first_name: values.firstName,
          last_name: values.lastName,
          email: values.email,
          phone: values.phone,
          company: values.company || "—",
          message: values.message || "—",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.message ?? `Bad response: ${res.status}`);
      }
      toast.success("Thanks! We received your request and will be in touch shortly.");
      reset();
    } catch {
      // Last-ditch so a lead is never silently lost: point them at the inbox.
      toast.error(`Something went wrong. Please email us directly at ${LEAD_EMAIL}.`);
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
              {/* Honeypot — visually and semantically hidden, off the tab order,
                  and told to browsers not to autofill. A human never touches it;
                  a bot that fills every field does. */}
              <input
                ref={honeypotRef}
                type="text"
                name="company_website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
                style={{ display: "none" }}
              />
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

              {/* An escape hatch for the visitor who does not want to fill in a
                  form. Set small and quiet, since the primary CTA above is what
                  we want them to click. The mailto: pre-addresses the draft, so
                  it costs one click instead of copying the address by hand. */}
              <p className="text-center text-sm text-dark-section-foreground/70 pt-1">
                Or email us at{" "}
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="font-semibold text-accent hover:underline underline-offset-2
                             focus-visible:outline-none focus-visible:ring-2
                             focus-visible:ring-accent focus-visible:ring-offset-2
                             focus-visible:ring-offset-dark-section rounded"
                >
                  {CONTACT.email}
                </a>
              </p>
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
