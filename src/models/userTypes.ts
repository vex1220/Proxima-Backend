import { User, User_Settings } from "@prisma/client";

export type VerifiedCampusSummary = { name: string; themeBrand: string | null };

export type UserWithPreferences = User & {
  preferences?: User_Settings | null;
  verifiedCampus?: VerifiedCampusSummary | null;
};