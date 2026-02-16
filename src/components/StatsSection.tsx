import { useEffect, useState, useRef } from "react";

const stats = [
  { value: 20000, label: "Customers", suffix: "+", display: "20k" },
  { value: 4.9, label: "Star Google Rating", suffix: "", display: "4.9" },
  { value: 55, label: "Years in Business", suffix: "+", display: "55" },
  { value: 25, label: "Locations", suffix: "+", display: "25" },
];

const StatsSection = () => {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className="bg-primary">
      <div className="container-wide px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={`stat-item transition-all duration-700 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
              style={{ transitionDelay: `${i * 150}ms` }}
            >
              <div className="stat-number">{stat.display}{stat.suffix}</div>
              <p className="text-primary-foreground/70 mt-2 text-sm font-medium">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
