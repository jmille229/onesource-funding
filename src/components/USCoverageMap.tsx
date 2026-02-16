/**
 * Simplified US states map. States NOT covered: CA, ND, SD, NC.
 * All other states shown in accent (green), excluded in muted.
 */

const excludedStates = ["CA", "ND", "SD", "NC"];

// Simplified US state paths (abbreviated subset for visual representation)
const states: { id: string; d: string }[] = [
  { id: "AL", d: "M628,396 L628,445 L610,460 L618,468 L640,450 L640,396Z" },
  { id: "AK", d: "M161,485 L183,485 L183,510 L205,510 L205,530 L150,530 L130,510Z" },
  { id: "AZ", d: "M205,370 L260,370 L270,440 L205,440Z" },
  { id: "AR", d: "M540,390 L600,390 L600,440 L540,440Z" },
  { id: "CA", d: "M120,240 L170,240 L190,340 L170,420 L120,420 L115,340Z" },
  { id: "CO", d: "M285,290 L380,290 L380,345 L285,345Z" },
  { id: "CT", d: "M810,215 L835,208 L840,230 L815,235Z" },
  { id: "DE", d: "M785,280 L800,275 L800,300 L785,300Z" },
  { id: "FL", d: "M650,445 L710,430 L730,470 L700,520 L670,500 L650,460Z" },
  { id: "GA", d: "M650,385 L700,385 L710,430 L650,445Z" },
  { id: "HI", d: "M270,490 L300,485 L310,500 L280,505Z" },
  { id: "ID", d: "M210,160 L250,160 L260,260 L210,260Z" },
  { id: "IL", d: "M570,250 L605,250 L610,340 L570,345Z" },
  { id: "IN", d: "M610,260 L645,260 L645,340 L610,340Z" },
  { id: "IA", d: "M490,230 L565,230 L565,285 L490,285Z" },
  { id: "KS", d: "M400,310 L500,310 L500,365 L400,365Z" },
  { id: "KY", d: "M610,325 L700,310 L700,350 L610,355Z" },
  { id: "LA", d: "M540,440 L600,440 L610,480 L560,490 L540,470Z" },
  { id: "ME", d: "M830,120 L860,110 L870,160 L840,175Z" },
  { id: "MD", d: "M740,275 L785,270 L790,295 L740,300Z" },
  { id: "MA", d: "M810,195 L850,188 L855,205 L815,210Z" },
  { id: "MI", d: "M600,160 L650,155 L660,240 L610,248Z" },
  { id: "MN", d: "M460,130 L530,130 L530,220 L460,220Z" },
  { id: "MS", d: "M590,395 L625,395 L625,460 L590,465Z" },
  { id: "MO", d: "M500,300 L570,295 L575,380 L510,385Z" },
  { id: "MT", d: "M250,130 L370,130 L370,195 L250,195Z" },
  { id: "NE", d: "M370,260 L490,255 L490,310 L370,310Z" },
  { id: "NV", d: "M175,230 L220,230 L230,350 L185,350Z" },
  { id: "NH", d: "M825,145 L845,140 L845,190 L825,195Z" },
  { id: "NJ", d: "M790,240 L810,235 L812,280 L790,285Z" },
  { id: "NM", d: "M260,370 L340,370 L340,450 L260,450Z" },
  { id: "NY", d: "M730,170 L810,160 L815,230 L730,240Z" },
  { id: "NC", d: "M650,340 L770,320 L775,355 L650,375Z" },
  { id: "ND", d: "M370,130 L460,130 L460,190 L370,190Z" },
  { id: "OH", d: "M645,245 L710,238 L715,310 L650,320Z" },
  { id: "OK", d: "M380,365 L500,360 L510,400 L400,405 L380,395Z" },
  { id: "OR", d: "M120,150 L210,150 L210,225 L120,230Z" },
  { id: "PA", d: "M710,225 L790,218 L790,265 L710,270Z" },
  { id: "RI", d: "M838,210 L852,207 L854,222 L840,225Z" },
  { id: "SC", d: "M680,370 L730,355 L740,390 L695,400Z" },
  { id: "SD", d: "M370,195 L460,195 L460,260 L370,260Z" },
  { id: "TN", d: "M580,350 L700,340 L700,375 L580,385Z" },
  { id: "TX", d: "M340,400 L470,395 L490,500 L400,510 L340,470Z" },
  { id: "UT", d: "M230,250 L290,250 L290,345 L230,345Z" },
  { id: "VT", d: "M810,145 L828,140 L828,190 L810,195Z" },
  { id: "VA", d: "M700,295 L780,280 L780,330 L700,340Z" },
  { id: "WA", d: "M130,100 L215,100 L215,160 L130,155Z" },
  { id: "WV", d: "M700,280 L740,270 L745,320 L710,325Z" },
  { id: "WI", d: "M530,150 L590,145 L595,240 L530,245Z" },
  { id: "WY", d: "M265,195 L370,195 L370,265 L265,265Z" },
];

const USCoverageMap = () => (
  <svg viewBox="100 90 790 460" className="w-full h-auto">
    {states.map((state) => {
      const excluded = excludedStates.includes(state.id);
      return (
        <path
          key={state.id}
          d={state.d}
          className={
            excluded
              ? "fill-muted stroke-border"
              : "fill-accent stroke-accent-foreground/20"
          }
          strokeWidth="1.5"
        >
          <title>{state.id}</title>
        </path>
      );
    })}
    {/* State labels */}
    {states.map((state) => {
      // Calculate rough center of path bounding box for label
      const nums = state.d.match(/\d+/g)?.map(Number) || [];
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      return (
        <text
          key={`label-${state.id}`}
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground text-[8px] font-sans font-medium pointer-events-none select-none"
        >
          {state.id}
        </text>
      );
    })}
  </svg>
);

export default USCoverageMap;
