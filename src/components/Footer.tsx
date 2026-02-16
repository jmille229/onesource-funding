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
            <img src="/logo.svg" alt="One Source Funding" className="h-12 brightness-0 invert" />
          </div>
          <p className="text-primary-foreground/60 text-sm leading-relaxed mb-6">
            Expert invoice factoring and accounts receivable management since 1969.
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

      <div className="border-t border-white/10 mt-12 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-primary-foreground/50 text-sm">
          © 2026 One Source Funding. All rights reserved.
        </p>
        <div className="flex gap-6">
          <a href="#" className="text-primary-foreground/50 text-sm hover:text-accent transition-colors">Privacy Policy</a>
          <a href="#" className="text-primary-foreground/50 text-sm hover:text-accent transition-colors">Terms of Service</a>
        </div>
      </div>
    </div>
  </footer>
);

export default Footer;
