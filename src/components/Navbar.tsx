import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X, ChevronDown } from "lucide-react";

// The customer portal (the invoice/subledger app) deploys separately on its own
// subdomain. Override per environment with VITE_APP_URL.
const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? "https://app.os-funding.com";

const navItems = [
  {
    label: "Services",
    children: ["Invoice Funding", "Credit Services", "Receivables Management"],
  },
  {
    label: "Industries",
    children: ["Trucking", "Staffing", "Manufacturing", "Government", "Oil & Gas"],
  },
  {
    label: "Resources",
    children: ["Blog", "FAQs", "Funding Calculator", "Case Studies"],
  },
  {
    label: "Why Us?",
    children: ["Why One Source", "About Us", "Our Team", "Testimonials", "Careers"],
  },
];

/**
 * Menu labels that have a real page. Everything else is still a placeholder
 * (href="#") until its page exists; the mobile menu shows only these.
 */
const NAV_ROUTES: Record<string, string> = {
  "Invoice Funding": "/invoice-funding",
  Blog: "/blog",
  FAQs: "/faq",
  "Why One Source": "/why-one-source",
};

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  return (
    <nav className="bg-card sticky top-0 z-50 shadow-sm border-b border-border">
      <div className="container-wide flex items-center justify-between px-4 sm:px-6 lg:px-8 py-4">
        <Link to="/" className="flex items-center gap-2">
          {/* 30% larger than the previous h-12 (48px) header mark, per request. */}
          <img src="/logo.png" alt="One Source Funding" className="h-[62px]" />
        </Link>

        {/* Desktop Nav */}
        <div className="hidden lg:flex items-center gap-1">
          {/* The software front door. A real destination among the placeholder
              dropdowns — this is the second entry point for contractors who want
              the free project/invoice app rather than funding. */}
          <Link
            to="/software"
            className="px-4 py-2 text-sm font-medium text-foreground hover:text-accent transition-colors rounded-md"
          >
            Software
          </Link>
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
                  {item.children.map((child) => {
                    const cls = "block px-4 py-2.5 text-sm text-foreground hover:bg-muted hover:text-accent transition-colors";
                    const route = NAV_ROUTES[child];
                    return route ? (
                      <Link key={child} to={route} className={cls} onClick={() => setOpenDropdown(null)}>
                        {child}
                      </Link>
                    ) : (
                      <a key={child} href="#" className={cls}>
                        {child}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-2">
          <a
            href={`${APP_URL}/login`}
            className="px-4 py-2 text-sm font-medium text-foreground hover:text-accent transition-colors rounded-md"
          >
            Log in
          </a>
          {/* "/#get-started", not "#get-started": the form only exists on the
              homepage, so a bare hash is a dead link on every other page.
              ScrollToTop handles the cross-route scroll. */}
          <Link to="/#get-started" className="btn-accent text-sm">
            Apply Now
          </Link>
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
            <Link
              to="/software"
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2.5 text-sm font-medium text-foreground hover:text-accent rounded-md"
            >
              Software
            </Link>
            <Link
              to="/how-it-works"
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2.5 text-sm font-medium text-foreground hover:text-accent rounded-md"
            >
              How It Works
            </Link>
            {/* Only the pages that exist — a list of placeholder links is worse
                than a short menu on a phone. */}
            {Object.entries(NAV_ROUTES).map(([label, route]) => (
              <Link
                key={label}
                to={route}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2.5 text-sm font-medium text-foreground hover:text-accent rounded-md"
              >
                {label === "Invoice Funding" ? "What Is Invoice Funding" : label}
              </Link>
            ))}
            <a
              href={`${APP_URL}/login`}
              className="block w-full text-center px-3 py-2.5 text-sm font-medium text-foreground hover:text-accent rounded-md border border-border mt-4"
            >
              Log in
            </a>
            <Link
              to="/#get-started"
              onClick={() => setMobileOpen(false)}
              className="btn-accent w-full text-center text-sm mt-2"
            >
              Apply Now
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
