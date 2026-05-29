import "dotenv/config";
import { prisma } from "../src/utils/prisma";

/**
 * Idempotent campus onboarding seed.
 *
 * For each entry it ensures the campus Location carries its theme brand and that
 * every email domain maps to that campus (CampusEmailDomain). This is the
 * template for onboarding a new university — add an entry and re-run:
 *
 *     npm run seed:campuses
 *
 * It will NOT create a campus Location from scratch: campuses need real
 * coordinates/size for the map + in-range checks, so create the CAMPUS location
 * first (admin "create location" flow), then run this to attach the theme +
 * domains. A custom theme also needs a matching palette + `ThemeBrand` entry in
 * the frontend `theme.ts` to actually render.
 */
type CampusSeed = {
  /** Case-insensitive name match against existing type=CAMPUS locations. */
  matchNames: string[];
  /** Theme brand unlocked for verified students of this campus (null = none). */
  themeBrand: string | null;
  /** Email domains that prove membership of this campus (store lowercase). */
  domains: string[];
};

const CAMPUSES: CampusSeed[] = [
  {
    matchNames: ["Florida State University", "Florida State", "FSU"],
    themeBrand: "fsu",
    domains: ["fsu.edu"],
  },
];

async function findCampus(seed: CampusSeed) {
  // Prefer an existing domain mapping if one of the domains is already wired up.
  for (const domain of seed.domains) {
    const existing = await prisma.campusEmailDomain.findFirst({
      where: { domain: { equals: domain, mode: "insensitive" } },
      select: { campus: { select: { id: true, name: true, deleted: true } } },
    });
    if (existing?.campus && !existing.campus.deleted) return existing.campus;
  }
  // Otherwise match by name among campus locations.
  for (const name of seed.matchNames) {
    const loc = await prisma.location.findFirst({
      where: { type: "CAMPUS", deleted: false, name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true, deleted: true },
    });
    if (loc) return loc;
  }
  return null;
}

async function run() {
  for (const seed of CAMPUSES) {
    const campus = await findCampus(seed);
    if (!campus) {
      console.warn(
        `[seed] Campus not found for "${seed.matchNames[0]}" — create the CAMPUS location first (with coordinates), then re-run.`,
      );
      continue;
    }

    await prisma.location.update({
      where: { id: campus.id },
      data: { themeBrand: seed.themeBrand },
    });
    console.log(
      `[seed] themeBrand="${seed.themeBrand}" on campus #${campus.id} (${campus.name})`,
    );

    for (const rawDomain of seed.domains) {
      const domain = rawDomain.trim().toLowerCase();
      await prisma.campusEmailDomain.upsert({
        where: { campusId_domain: { campusId: campus.id, domain } },
        update: {},
        create: { campusId: campus.id, domain },
      });
      console.log(`[seed] domain "${domain}" → campus #${campus.id}`);
    }
  }
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
