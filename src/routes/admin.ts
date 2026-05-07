import { Router } from "express";
import { PerfTimer } from "../utils/perfTimer";

const router = Router();

router.get("/perf", (_req, res) => {
  res.json({ enabled: PerfTimer.isEnabled(), stats: PerfTimer.getStats() });
});

router.post("/perf/reset", (_req, res) => {
  PerfTimer.reset();
  res.json({ message: "Stats reset" });
});

router.post("/perf/toggle", (_req, res) => {
  if (PerfTimer.isEnabled()) {
    PerfTimer.disable();
  } else {
    PerfTimer.enable();
  }
  res.json({ enabled: PerfTimer.isEnabled() });
});

export default router;
