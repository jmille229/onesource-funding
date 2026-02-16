import { Phone, MapPin, Mail, LogIn } from "lucide-react";

const TopBar = () => (
  <div className="bg-primary text-primary-foreground text-sm">
    <div className="container-wide flex items-center justify-between px-4 sm:px-6 lg:px-8 py-2">
      <a href="tel:1-800-555-1234" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
        <Phone className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">800.555.1234</span>
      </a>
      <div className="flex items-center gap-4 sm:gap-6">
        <a href="#locations" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
          <MapPin className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Locations</span>
        </a>
        <a href="#contact" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
          <Mail className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Contact Us</span>
        </a>
        <a href="#login" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
          <LogIn className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Login</span>
        </a>
      </div>
    </div>
  </div>
);

export default TopBar;
