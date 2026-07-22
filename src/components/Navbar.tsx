import { useState } from "react";
import { Menu, X, ChevronDown } from "lucide-react";

// The customer portal (the invoice/subledger app) deploys separately on its own
// subdomain. Override per environment with VITE_APP_URL.
const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? "https://app.os-funding.com";

const navItems = [
  {
    label: "Services",
    children: ["Invoice Factoring", "Credit Services", "Receivables Management"],
  },
  {
    label: "Industries",
    children: ["Trucking", "Staffing", "Manufacturing", "Government", "Oil & Gas"],
  },
  {
    label: "Resources",
    children: ["Blog", "FAQs", "Factoring Calculator", "Case Studies"],
  },
  {
    label: "Why Us?",
    children: ["About Us", "Our Team", "Testimonials", "Careers"],
  },
];

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  return (
    <nav className="bg-card sticky top-0 z-50 shadow-sm border-b border-border">
      <div className="container-wide flex items-center justify-between px-4 sm:px-6 lg:px-8 py-4">
        <a href="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="One Source Funding" className="h-12" />
        </a>

        {/* Desktop Nav */}
        <div className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => (
            <div
              key={item.label}
              className="relative group"
              onMouseEnter={() => item.children && setOpenDropdown(item.label)}
              onMouseLeave={() => setOpenDropdown(null)}
              onFocus={() => item.children && setOpenDropdown(item.label)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpenDropdown(null);
              }}
            >
              <button
                type="button"
                aria-haspopup={item.children ? "true" : undefined}
                aria-expanded={item.children ? openDropdown === item.label : undefined}
                className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-foreground hover:text-accent transition-colors rounded-md"
              >
                {item.label}
                {item.children && <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {item.children && openDropdown === item.label && (
                <div className="absolute top-full left-0 bg-card rounded-lg shadow-xl border border-border py-2 min-w-[200px] animate-fade-in">
                  {item.children.map((child) => (
                    <a
                      key={child}
                      href="#"
                      className="block px-4 py-2.5 text-sm text-foreground hover:bg-muted hover:text-accent transition-colors"
                    >
                      {child}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-2">
          <a
            href={APP_URL}
            className="px-4 py-2 text-sm font-medium text-foreground hover:text-accent transition-colors rounded-md"
          >
            Log in
          </a>
          <a href="#get-started" className="btn-accent text-sm">
            Apply Now
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          className="lg:hidden p-2 text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden bg-card border-t border-border animate-fade-in">
          <div className="px-4 py-4 space-y-2">
            {navItems.map((item) => (
              <div key={item.label}>
                <a
                  href="#"
                  className="block px-3 py-2.5 text-sm font-medium text-foreground hover:text-accent rounded-md"
                >
                  {item.label}
                </a>
              </div>
            ))}
            <a
              href={APP_URL}
              className="block w-full text-center px-3 py-2.5 text-sm font-medium text-foreground hover:text-accent rounded-md border border-border mt-4"
            >
              Log in
            </a>
            <a href="#get-started" className="btn-accent w-full text-center text-sm mt-2">
              Apply Now
            </a>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
