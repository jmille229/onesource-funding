import type { Project, Subcontract, TradeKey } from "./types";

// Locate-mark color code, borrowed from the jobsite. Encodes trade, not decoration.
export const TRADE: Record<TradeKey, { label: string; color: string }> = {
  concrete: { label: "Concrete", color: "#6E7278" },
  carpentry: { label: "Carpentry", color: "#8A6A3D" },
  plumbing: { label: "Plumbing", color: "#1F63A8" },
  hvac: { label: "HVAC", color: "#E0A80F" },
  electric: { label: "Electrical", color: "#C8342A" },
  roofing: { label: "Roofing", color: "#2E7D5B" },
  sitework: { label: "Sitework", color: "#D2691E" },
};

export const PROJECT: Project = {
  number: "2026-118",
  name: "Maple Row Duplex",
  address: "4418 Maple Row Ave, Unit A & B",
  client: "Vance Development LLC",
  contractValue: 512000,
  start: "2026-02-02",
  finish: "2026-11-20",
};

export const SEED: Subcontract[] = [
  {
    id: 1, firm: "Rivera Concrete & Flatwork", trade: "concrete", costCode: "03 300",
    amount: 48000, billed: 48000, retainagePct: 10,
    start: "2026-02-10", finish: "2026-03-14", status: "Complete",
    scope: "Footings, stem walls, slab-on-grade, driveway approach and rear patio flatwork. Includes vapor barrier and rebar.",
    permits: "None — GC holds site permit",
    cert: "MBE", coi: "2026-11-02", w9: true, contact: "L. Rivera · (555) 204-8817",
  },
  {
    id: 2, firm: "Cardinal Framing Co.", trade: "carpentry", costCode: "06 100",
    amount: 96000, billed: 72000, retainagePct: 10,
    start: "2026-03-20", finish: "2026-06-05", status: "Complete",
    scope: "Rough framing both units, roof trusses set, sheathing, window and door bucks. Excludes exterior finish carpentry.",
    permits: "None",
    cert: "—", coi: "2027-04-30", w9: true, contact: "D. Okafor · (555) 331-0042",
  },
  {
    id: 3, firm: "Brightline Plumbing", trade: "plumbing", costCode: "22 000",
    amount: 58900, billed: 20000, retainagePct: 5,
    start: "2026-06-01", finish: "2026-09-12", status: "In progress",
    scope: "Underground rough-in, water service tie-in, DWV, gas line to both units, fixture set-out. Water heaters by owner.",
    permits: "Plumbing permit P-4471 — held by sub",
    cert: "—", coi: "2026-06-30", w9: true, contact: "S. Whitfield · (555) 990-1233",
  },
  {
    id: 4, firm: "Delgado Mechanical", trade: "hvac", costCode: "23 000",
    amount: 62500, billed: 31250, retainagePct: 10,
    start: "2026-06-15", finish: "2026-08-30", status: "In progress",
    scope: "Two 3-ton split systems, duct fabrication and install, bath and dryer exhaust, Manual J on file. Startup and balance included.",
    permits: "Mechanical permit M-2210 — held by sub",
    cert: "MBE", coi: "2026-08-04", w9: true, contact: "A. Delgado · (555) 447-6690",
  },
  {
    id: 5, firm: "Nguyen Electric", trade: "electric", costCode: "26 000",
    amount: 71400, billed: 35700, retainagePct: 10,
    start: "2026-06-22", finish: "2026-09-25", status: "In progress",
    scope: "Service upgrade to 200A per unit, panel set, rough-in, device trim, exterior lighting, EV-ready conduit to both garages.",
    permits: "Electrical permit E-2291 — held by sub",
    cert: "WBE / MBE", coi: "2027-01-19", w9: true, contact: "T. Nguyen · (555) 812-3374",
  },
  {
    id: 6, firm: "Sunset Roofing", trade: "roofing", costCode: "07 300",
    amount: 41800, billed: 0, retainagePct: 0,
    start: "2026-08-04", finish: "2026-08-29", status: "Not started",
    scope: "Architectural shingle, ice-and-water at eaves and valleys, ridge vent, all flashing and boots. 10-year workmanship warranty.",
    permits: "None",
    cert: "MBE", coi: "2026-12-15", w9: false, contact: "R. Castellanos · (555) 668-2201",
  },
];
