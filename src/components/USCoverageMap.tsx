import usStates from "@/data/usStates.json";

const excludedStates = ["CA", "ND", "SD", "NC"];

type StateFeature = { id: string; name: string; d: string };
const states = usStates as StateFeature[];

const USCoverageMap = () => {
  const covered = states.filter((s) => !excludedStates.includes(s.id)).length;
  return (
    <div className="w-full">
      <svg
        viewBox="0 0 960 600"
        className="w-full h-auto"
        role="img"
        aria-label="Map of United States showing service coverage"
      >
        <defs>
          <filter id="mapShadow" x="-2%" y="-2%" width="104%" height="104%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
          </filter>
        </defs>
        <g filter="url(#mapShadow)">
          {states.map((state) => {
            const excluded = excludedStates.includes(state.id);
            return (
              <path
                key={state.id}
                d={state.d}
                className={
                  excluded
                    ? "fill-muted stroke-background hover:fill-muted/80 transition-colors"
                    : "fill-accent stroke-background hover:fill-accent/80 transition-colors"
                }
                strokeWidth={1}
                strokeLinejoin="round"
              >
                <title>{`${state.name} — ${excluded ? "Not currently serviced" : "Covered"}`}</title>
              </path>
            );
          })}
        </g>
      </svg>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 h-4 rounded-sm bg-accent border border-background" />
          <span className="text-foreground font-medium">Covered ({covered} states)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 h-4 rounded-sm bg-muted border border-background" />
          <span className="text-muted-foreground">Not currently serviced</span>
        </div>
      </div>
    </div>
  );
};

export default USCoverageMap;
