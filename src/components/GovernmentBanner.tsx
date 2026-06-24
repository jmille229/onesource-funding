import { Landmark, ShieldCheck, FileCheck2 } from "lucide-react";

const GovernmentBanner = () => (
  <section className="bg-accent text-accent-foreground">
    <div className="container-wide px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid md:grid-cols-3 gap-6 items-center text-center md:text-left">
        <div className="flex items-center justify-center md:justify-start gap-3">
          <Landmark className="h-8 w-8 shrink-0" />
          <p className="font-display font-bold text-lg leading-tight">
            100% Focused on Government Contractors
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <ShieldCheck className="h-8 w-8 shrink-0" />
          <p className="font-medium leading-tight">
            Federal, State & Local Agency Receivables
          </p>
        </div>
        <div className="flex items-center justify-center md:justify-end gap-3">
          <FileCheck2 className="h-8 w-8 shrink-0" />
          <p className="font-medium leading-tight">
            Expertise in Government Payment Cycles
          </p>
        </div>
      </div>
    </div>
  </section>
);

export default GovernmentBanner;
