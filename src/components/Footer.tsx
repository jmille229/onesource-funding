import { Facebook, Twitter, Linkedin, Instagram, Youtube } from "lucide-react";

const footerLinks = {
  Company: ["About Us", "Our Team", "Careers", "Contact Us"],
  Partner: ["Referral Program", "Broker Program", "CPA Program"],
  "Invoice Factoring": ["What is Factoring", "How It Works", "Industries", "Freight Factoring"],
  Resources: ["Blog", "FAQs", "Calculator", "Case Studies"],
};

const socialLinks = [
  { icon: Facebook, label: "Facebook" },
  { icon: Twitter, label: "Twitter" },
  { icon: Linkedin, label: "LinkedIn" },
  { icon: Instagram, label: "Instagram" },
  { icon: Youtube, label: "YouTube" },
];

const Footer = () => (
  <footer className="bg-primary text-primary-foreground">
    <div className="container-wide px-4 sm:px-6 lg:px-8 py-16">
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-8">
        {/* Brand */}
        <div className="lg:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <img src="/logo.png" alt="One Source Funding" className="h-12 brightness-0 invert" />
          </div>
          <p className="text-primary-foreground/60 text-sm leading-relaxed mb-6">
            Invoice factoring built exclusively for U.S. government contractors.
          </p>
          <div className="flex gap-3">
            {socialLinks.map((s) => (
              <a
                key={s.label}
                href="#"
                aria-label={s.label}
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-accent transition-colors"
              >
                <s.icon className="h-4 w-4" />
              </a>
            ))}
          </div>
        </div>

        {/* Links */}
        {Object.entries(footerLinks).map(([title, links]) => (
          <div key={title}>
            <h4 className="font-display font-bold text-sm mb-4">{title}</h4>
            <ul className="space-y-2.5">
              {links.map((link) => (
                <li key={link}>
                  <a href="#" className="text-primary-foreground/60 text-sm hover:text-accent transition-colors">
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/*
        Association membership sits in the legal bar rather than the link grid.
        A trade body mark is a credibility signal, not navigation — it belongs
        beside the copyright and policy links, which is where a prospect looks
        when they are deciding whether we are a real counterparty.

        The white chip is deliberate and load-bearing. This footer is dark navy
        (--primary: 213 55% 22%) and the IFA mark is blue; placed straight onto
        the background it reads as muddy and fails contrast. The OneSource logo
        above solves that with `brightness-0 invert`, but recolouring another
        organisation's mark is not ours to do — most associations require theirs
        to appear unaltered on a light background. The chip gives it exactly that
        while leaving the file untouched: fixed height, auto width, no filters,
        no crop.
      */}
      <div className="border-t border-white/10 mt-12 pt-8 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span className="text-primary-foreground/50 text-xs uppercase tracking-wider">
            Proud member of
          </span>
          <a
            href="https://www.factoring.org/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="International Factoring Association — opens in a new tab"
            className="inline-flex items-center rounded-lg bg-white px-4 py-2.5 transition-shadow
                       hover:shadow-lg focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-accent focus-visible:ring-offset-2
                       focus-visible:ring-offset-primary"
          >
            <img
              src="/ifa-member.png"
              alt="International Factoring Association"
              // The IFA mark is a lockup: "IFA" over the association name in
              // small caps. Sized so that fine print stays legible — below about
              // 100px wide the second line turns to mush. Height-driven with
              // w-auto, so the aspect ratio comes from the file, never from here.
              className="h-12 sm:h-14 w-auto"
              loading="lazy"
              decoding="async"
            />
          </a>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
          <p className="text-primary-foreground/50 text-sm">
            © 2026 One Source Funding. All rights reserved.
          </p>
          <div className="flex gap-6">
            <a href="#" className="text-primary-foreground/50 text-sm hover:text-accent transition-colors">Privacy Policy</a>
            <a href="#" className="text-primary-foreground/50 text-sm hover:text-accent transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </div>
  </footer>
);

export default Footer;
