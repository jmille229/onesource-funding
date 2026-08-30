import { Phone, MapPin, Mail, LogIn, Shield } from "lucide-react";
import { CONTACT } from "@/lib/contact";

/**
 * The top utility bar.
 *
 * Phone lives here because it is the fastest path for a contractor who has
 * already decided to reach out — visible in one glance on every page, from any
 * scroll position, on desktop. Below sm it collapses to the icon alone so the
 * dark strip does not turn into a wall of small text.
 *
 * "Contact Us" was a link to the on-page form; it is now a real mailto: to
 * info@os-funding.com. Same label, but a visitor who prefers email gets a
 * pre-addressed draft rather than a scroll to a form. The form still exists
 * for anyone who does not want to leave the page.
 */
const TopBar = () => (
  <div className="bg-primary text-primary-foreground text-sm">
    <div className="container-wide flex items-center justify-between px-4 sm:px-6 lg:px-8 py-2">
      <div className="flex items-center gap-4">
        <a
          href={`tel:${CONTACT.phoneTel}`}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                     focus-visible:ring-offset-2 focus-visible:ring-offset-primary rounded"
          aria-label={`Call ${CONTACT.phone}`}
        >
          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{CONTACT.phone}</span>
        </a>
        <span className="hidden md:flex items-center gap-1.5 text-accent font-semibold uppercase tracking-wider text-xs">
          <Shield className="h-3.5 w-3.5" aria-hidden="true" />
          Exclusively Serving the U.S. Government Market
        </span>
      </div>
      <div className="flex items-center gap-4 sm:gap-6">
        <a href="#locations"
           className="flex items-center gap-1.5 hover:opacity-80 transition-opacity
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                      focus-visible:ring-offset-2 focus-visible:ring-offset-primary rounded">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Locations</span>
        </a>
        <a
          href={`mailto:${CONTACT.email}`}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                     focus-visible:ring-offset-2 focus-visible:ring-offset-primary rounded"
          aria-label={`Email ${CONTACT.email}`}
        >
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Contact Us</span>
        </a>
        <a href="#login"
           className="flex items-center gap-1.5 hover:opacity-80 transition-opacity
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                      focus-visible:ring-offset-2 focus-visible:ring-offset-primary rounded">
          <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Login</span>
        </a>
      </div>
    </div>
  </div>
);

export default TopBar;
